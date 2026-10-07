/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createRunAudit,
  buildChildEnv,
  chromeFlagsFor,
  sanitizeExtraFlags,
} = require('../../src/service/run-audit.js');
const {serializeRun, reviveRun} = require('../../src/service/run-result.js');
const {summarizeRun} = require('../../src/summary/run-summary.js');
const recommended = require('../../src/recommended-assertions.json');
const {audit, lhr} = require('../summary/fixtures.js');

const ALLOWED = ['*.stage.example.org'];
const URL_OK = 'https://pr-1.stage.example.org/';

/** A fake collect step that writes an lhr like `lhci collect` does. */
const fakeCollect =
  (audits, extra = {}) =>
  async job => {
    const folder = path.join(job.cwd, '.lighthouseci');
    fs.mkdirSync(folder, {recursive: true});
    fs.writeFileSync(
      path.join(folder, 'lhr-1.json'),
      JSON.stringify({...lhr(audits, {url: job.url}), ...extra})
    );
  };
const fakeProxy =
  (blocked = []) =>
  async () => ({
    port: 1,
    url: 'http://127.0.0.1:1',
    blocked,
    denied: [],
    close: async () => {},
  });

function make(over = {}) {
  const calls = {collect: [], assertPublic: []};
  const runAudit = createRunAudit({
    recommended,
    lhciCli: '/cli.js',
    lighthouseConfig: '/config.js',
    env: {PATH: '/bin', HOME: '/home/x', SECRET_TOKEN: 'leak-me'},
    tmpRoot: os.tmpdir(),
    collect: async job => {
      calls.collect.push(job);
      return (over.collect || fakeCollect({'canonical-https': audit(1)}))(job);
    },
    startProxy: over.startProxy || fakeProxy(),
    assertPublic: async host => {
      calls.assertPublic.push(host);
      if (over.assertPublic) return over.assertPublic(host);
      return undefined;
    },
  });
  return {runAudit, calls};
}

const input = (over = {}) => ({
  run: {id: 'r1', projectId: 'p1', url: URL_OK, branch: 'feat', baseBranch: 'main'},
  project: {},
  config: {},
  allowedHosts: ALLOWED,
  signal: new AbortController().signal,
  ...over,
});

describe('runAudit', () => {
  it('runs collect once for the checked url, scores it, and reports no baseline', async () => {
    const {runAudit, calls} = make();
    const result = await runAudit(input());
    expect(calls.collect).toHaveLength(1);
    expect(calls.collect[0].url).toBe(URL_OK);
    expect(calls.assertPublic).toEqual(['pr-1.stage.example.org']);
    expect(result).toMatchObject({
      version: 1,
      url: URL_OK,
      comparison: null,
      baselineNote: 'no earlier run to compare with',
    });
    expect(result.summary.audits.find(a => a.id === 'canonical-https').status).toBe('pass');
  });

  it('refuses before any Chrome run: off-list host, private resolution', async () => {
    let {runAudit, calls} = make();
    await expect(runAudit(input({run: {id: 'r', url: 'https://evil.net/'}}))).rejects.toThrow(
      /url refused: host "evil.net"/
    );
    expect(calls.collect).toHaveLength(0);

    ({runAudit, calls} = make({
      assertPublic: async () => {
        throw new Error(
          'refusing to connect to "x": resolves to a private/reserved address (10.0.0.1).'
        );
      },
    }));
    await expect(runAudit(input())).rejects.toThrow(/private\/reserved/);
    expect(calls.collect).toHaveLength(0);
  });

  it('applies the project rules: an audit switched off is not scored', async () => {
    const audits = {'canonical-https': audit(0), 'sitemap-valid': audit(0)};
    const {runAudit} = make({collect: fakeCollect(audits)});
    const result = await runAudit(input({config: {audits: {'canonical-https': 'off'}}}));
    const ids = result.summary.audits.map(a => a.id);
    expect(ids).toContain('sitemap-valid');
    expect(ids).not.toContain('canonical-https');
  });

  it('rejects an invalid project config before running Chrome', async () => {
    const {runAudit, calls} = make();
    await expect(runAudit(input({config: {preset: 'nope'}}))).rejects.toThrow(/unknown preset/);
    expect(calls.collect).toHaveLength(0);
  });

  it('compares with the baseline and names what is new and fixed', async () => {
    const earlierLhr = lhr({'canonical-https': audit(1), 'sitemap-valid': audit(0)});
    const earlier = serializeRun(summarizeRun(earlierLhr, recommended));
    const {runAudit} = make({
      collect: fakeCollect({'canonical-https': audit(0), 'sitemap-valid': audit(1)}),
    });
    const seen = [];
    const result = await runAudit(
      input({
        findBaseline: async c => {
          seen.push(c);
          return {summary: earlier};
        },
      })
    );
    expect(seen[0]).toMatchObject({projectId: 'p1', baseBranch: 'main', excludeRunId: 'r1'});
    expect(result.comparison.newIssues.map(a => a.id)).toEqual(['canonical-https']);
    expect(result.comparison.fixed.map(a => a.id)).toEqual(['sitemap-valid']);
    expect(result.baselineNote).toBe('');
  });

  describe('templates', () => {
    const withTemplates = templates => ({
      'template-groups-report': audit(1, {
        scoreDisplayMode: 'informative',
        details: {type: 'table', headings: [], items: [], templates},
      }),
    });
    const tpl = {pattern: '/blog/:slug', pages: 4, examples: [], problems: [], systemic: []};

    it('stores the template groups the audit found', async () => {
      const {runAudit} = make({
        collect: fakeCollect({'canonical-https': audit(1), ...withTemplates([tpl])}),
      });
      expect((await runAudit(input())).templates).toEqual([tpl]);
    });

    it('stores none for a page without the audit, and ignores a damaged value', async () => {
      const none = await make({collect: fakeCollect({'canonical-https': audit(1)})}).runAudit(
        input()
      );
      expect(none.templates).toEqual([]);
      const damaged = await make({
        collect: fakeCollect({'canonical-https': audit(1), ...withTemplates('<b>hostile</b>')}),
      }).runAudit(input());
      expect(damaged.templates).toEqual([]);
    });
  });

  describe('search result preview', () => {
    const {buildSerpPreview} = require('../../src/lib/serp-preview.js');
    const budgets = {title: {desktop: 600, mobile: 580}, description: {desktop: 920, mobile: 680}};
    const fonts = {title: '400 20px Arial', description: '400 14px Arial'};
    const preview = title =>
      buildSerpPreview({
        url: 'https://example.com/',
        title: {
          text: title,
          widthPx: title.length * 5,
          prefixWidths: [...title].map((_, i) => (i + 1) * 5),
        },
        budgets,
        fonts,
      });
    const withPreview = p => ({
      'pixel-width-truncation': audit(null, {
        scoreDisplayMode: 'informative',
        details: {type: 'table', headings: [], items: [], serpPreview: p},
      }),
    });

    it('stores the snippet the audit modelled, and what changed since the baseline', async () => {
      const {runAudit} = make({
        collect: fakeCollect({'canonical-https': audit(1), ...withPreview(preview('New title'))}),
      });
      const result = await runAudit(
        input({
          findBaseline: async () => ({
            summary: serializeRun(summarizeRun(lhr({'canonical-https': audit(1)}), recommended)),
            serp: preview('Old title'),
          }),
        })
      );
      expect(result.serp.devices.desktop.title.shown).toBe('New title');
      expect(result.serpChange).toEqual({
        titleChanged: true,
        descriptionChanged: false,
        urlChanged: false,
      });
    });

    it('has no preview for a page without the audit result, and ignores a damaged one', async () => {
      const none = await make({collect: fakeCollect({'canonical-https': audit(1)})}).runAudit(
        input()
      );
      expect(none.serp).toBeNull();
      expect(none.serpChange).toBeNull();
      const damaged = await make({
        collect: fakeCollect({
          'canonical-https': audit(1),
          ...withPreview({version: 9, hostile: '<b>'}),
        }),
      }).runAudit(input());
      expect(damaged.serp).toBeNull();
    });
  });

  it('treats a missing, broken or throwing baseline as "no comparison", not a failed run', async () => {
    for (const findBaseline of [
      async () => null,
      async () => ({summary: {junk: 1}}),
      async () => {
        throw new Error('db down');
      },
    ]) {
      const {runAudit} = make();
      const result = await runAudit(input({findBaseline}));
      expect(result.comparison).toBeNull();
      expect(result.baselineNote).not.toBe('');
    }
  });

  it('fails clearly when Lighthouse could not load the page, and says if a private address was blocked', async () => {
    const {runAudit} = make({
      collect: fakeCollect({}, {runtimeError: {code: 'ERRORED_DOCUMENT_REQUEST'}}),
      startProxy: fakeProxy([{host: '169.254.169.254', reason: 'a private or reserved address'}]),
    });
    await expect(runAudit(input())).rejects.toThrow(
      /ERRORED_DOCUMENT_REQUEST\). The page tried to reach 169\.254\.169\.254/
    );
  });

  it('fails when collect leaves no report, and cleans up the folder and the proxy either way', async () => {
    let closed = 0;
    let dir;
    const {runAudit} = make({
      collect: async job => {
        dir = job.cwd;
      },
      startProxy: async () => ({
        port: 1,
        url: 'http://127.0.0.1:1',
        blocked: [],
        denied: [],
        close: async () => closed++,
      }),
    });
    await expect(runAudit(input())).rejects.toThrow(/produced no report/);
    expect(closed).toBe(1);
    expect(fs.existsSync(dir)).toBe(false);

    const second = make({
      collect: async job => {
        dir = job.cwd;
        throw new Error('lhci collect failed (exit 1)');
      },
      startProxy: async () => ({
        port: 1,
        url: 'http://127.0.0.1:1',
        blocked: [],
        denied: [],
        close: async () => closed++,
      }),
    });
    await expect(second.runAudit(input())).rejects.toThrow(/exit 1/);
    expect(closed).toBe(2);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('gives the child a scrubbed environment, its own cache folder, and flags that force the proxy', async () => {
    const {runAudit, calls} = make();
    await runAudit(input());
    const {env, chromeFlags, cwd} = calls.collect[0];
    expect(env.SECRET_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(env.LHCI_SEO_CRAWL_CACHE_DIR).toBe(path.join(cwd, 'crawl-cache'));
    expect(chromeFlags).toContain('--proxy-server=http://127.0.0.1:1');
    expect(chromeFlags).toContain('--proxy-bypass-list=<-loopback>');
  });
});

describe('buildChildEnv', () => {
  const base = {cacheDir: '/c'};

  it('passes only the allow-listed names and the audit settings', () => {
    const env = buildChildEnv(
      {
        PATH: '/bin',
        HOME: '/h',
        DATABASE_URL: 'postgres://secret',
        AWS_SECRET_ACCESS_KEY: 'k',
        NODE_OPTIONS: '--inspect',
        LHCI_SEO_CRAWL_MAX_PAGES: '10',
        LHCI_SEO_CRUX_API_KEY: 'crux',
      },
      base
    );
    expect(Object.keys(env).sort()).toEqual([
      'HOME',
      'LHCI_SEO_CRAWL_CACHE_DIR',
      'LHCI_SEO_CRAWL_MAX_PAGES',
      'LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS',
      'LHCI_SEO_CRUX_API_KEY',
      'PATH',
    ]);
    expect(env.LHCI_SEO_CRAWL_MAX_PAGES).toBe('10');
  });

  it("never passes the private-network opt-in, or the service's own settings", () => {
    const env = buildChildEnv(
      {
        LHCI_SEO_ALLOW_PRIVATE_NETWORK: '1',
        LHCI_SEO_SERVICE: 'on',
        LHCI_SEO_SERVICE_CHROME_FLAGS: '--no-sandbox',
      },
      base
    );
    expect(env.LHCI_SEO_ALLOW_PRIVATE_NETWORK).toBeUndefined();
    expect(env.LHCI_SEO_SERVICE).toBeUndefined();
    expect(env.LHCI_SEO_SERVICE_CHROME_FLAGS).toBeUndefined();
  });

  it('sets crawl limits by default, and forces a private cache folder even if the server has one', () => {
    const env = buildChildEnv({LHCI_SEO_CRAWL_CACHE_DIR: '/shared'}, base);
    expect(env.LHCI_SEO_CRAWL_MAX_PAGES).toBe('30');
    expect(env.LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS).toBe('60');
    expect(env.LHCI_SEO_CRAWL_CACHE_DIR).toBe('/c');
  });
});

describe('chrome flags', () => {
  it('keeps operator flags such as --no-sandbox, drops any that could undo the guard, and puts the guard last', () => {
    expect(
      sanitizeExtraFlags(
        '--no-sandbox --proxy-server=http://evil --host-resolver-rules=MAP\\ *\\ 1.2.3.4 --proxy-bypass-list=* --disable-gpu'
      )
    ).toEqual(['--no-sandbox', '--disable-gpu']);
    const flags = chromeFlagsFor('http://127.0.0.1:9', '--no-sandbox --proxy-server=http://evil');
    expect(flags.split(' ')[0]).toBe('--no-sandbox');
    expect(flags).not.toContain('evil');
    expect(flags.indexOf('--proxy-server=http://127.0.0.1:9')).toBeGreaterThan(
      flags.indexOf('--no-sandbox')
    );
  });
});

describe('run result round trip', () => {
  it('revives what was stored, and refuses damaged data', () => {
    const summary = summarizeRun(
      lhr({'canonical-https': audit(0), 'sitemap-valid': audit(1)}),
      recommended
    );
    const revived = reviveRun(JSON.parse(JSON.stringify(serializeRun(summary))));
    expect(revived.overall).toEqual(summary.overall);
    expect(revived.issues.map(a => a.id)).toEqual(['canonical-https']);
    expect(revived.audits.get('sitemap-valid').status).toBe('pass');
    for (const bad of [null, 5, {}, {audits: 'x'}, {audits: [], overall: null, categories: []}]) {
      expect(reviveRun(bad)).toBeNull();
    }
    const withJunk = serializeRun(summary);
    withJunk.audits.push({id: 5}, null, {id: 'x', tier: 'gold', status: 'pass', reach: 1});
    expect(reviveRun(withJunk).auditsFound).toBe(summary.audits.size);
  });
});
