/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  renderPrComment,
  markerFor,
  alertParts,
  slackBody,
  teamsBody,
  safe,
  slackSafe,
  MAX_COMMENT_CHARS,
} = require('../../src/service/pr-comment.js');

const issue = (id, over = {}) => ({
  id,
  title: `Title of ${id}`,
  tier: 'error',
  status: 'fail',
  displayValue: '2 problems',
  explanation: '',
  ...over,
});
const cats = [
  {name: 'Page metadata', score: 90, grade: 'A', applicable: 3},
  {name: 'Images', score: 70, grade: 'C', applicable: 2},
  {name: 'Empty category', score: null, grade: 'n/a', applicable: 0},
];
const summary = (audits = []) => ({overall: {score: 85.04, grade: 'B'}, categories: cats, audits});
const run = {
  url: 'https://pr-1.example.com/',
  sha: 'ABCDEF1234567',
  branch: 'feat',
  baseBranch: 'main',
};

// An "@" not followed by a zero-width space would notify a user. (Built from a string: Prettier rewrites a literal.)
const BARE_AT = new RegExp('@(?!\\u200b)');

describe('renderPrComment', () => {
  it('starts with the hidden marker for the project', () => {
    const text = renderPrComment({
      projectId: 'p-1',
      run,
      result: {summary: summary(), url: run.url},
    });
    expect(text.split('\n')[0]).toBe(markerFor('p-1'));
    expect(markerFor('p-1')).toBe('<!-- lhci-seo-audit:p-1 -->');
  });

  it('shows the score, the change since the baseline, category movement, and the new, fixed and remaining issues', () => {
    const text = renderPrComment({
      projectId: 'p',
      run,
      reportUrl: 'https://svc.example.com/app/seo/p/runs/r1',
      result: {
        url: run.url,
        summary: summary(),
        comparison: {
          overallDelta: -3.2,
          categories: [
            {name: 'Page metadata', delta: 0},
            {name: 'Images', delta: -6.5},
          ],
          newIssues: [issue('canonical-https')],
          fixed: [issue('sitemap-valid')],
          stillFailing: [issue('broken-images', {tier: 'warn', status: 'warn'})],
        },
      },
    });
    expect(text).toContain('## SEO audit: 85.0 (B) (-3.2)');
    expect(text).toContain('commit `abcdef1`');
    expect(text).toContain('Compared with the latest run on `main`');
    expect(text).toContain('| Page metadata | 90.0 (A) | no change |');
    expect(text).toContain('| Images | 70.0 (C) | -6.5 |');
    expect(text).not.toContain('Empty category');
    expect(text).toContain('### New issues (1)');
    expect(text).toContain('**Error:** Title of canonical-https (`canonical-https`): 2 problems');
    expect(text).toContain('### Fixed (1)');
    expect(text).toContain('### Still failing (1)');
    expect(text).toContain('**Warning:**');
    expect(text).toContain('[Full report](https://svc.example.com/app/seo/p/runs/r1)');
  });

  it('on a first run lists the current issues and says there was nothing to compare with', () => {
    const text = renderPrComment({
      projectId: 'p',
      run,
      result: {
        url: run.url,
        baselineNote: 'no earlier run to compare with',
        summary: summary([issue('x'), issue('ok', {status: 'pass'})]),
      },
    });
    expect(text).toContain('_no earlier run to compare with_');
    expect(text).toContain('### Issues (1)');
    expect(text).not.toContain('Title of ok');
  });

  it('says so when nothing changed', () => {
    const text = renderPrComment({
      projectId: 'p',
      run,
      result: {
        url: run.url,
        summary: summary(),
        comparison: {overallDelta: 0, categories: [], newIssues: [], fixed: [], stillFailing: []},
      },
    });
    expect(text).toContain('No issues were added or fixed by this change.');
  });

  it('caps long lists', () => {
    const many = Array.from({length: 40}, (_, i) => issue(`a${i}`));
    const text = renderPrComment({
      projectId: 'p',
      run,
      result: {
        url: run.url,
        summary: summary(),
        comparison: {overallDelta: 1, categories: [], newIssues: many, fixed: [], stillFailing: []},
      },
    });
    expect(text).toContain('### New issues (40)');
    expect(text).toContain('...and 30 more');
    expect((text.match(/\*\*Error:\*\*/g) || []).length).toBe(10);
  });

  it('survives a result with no usable summary, and keeps any comment under the size limit', () => {
    expect(renderPrComment({projectId: 'p', run, result: null})).toContain('produced no score');
    const huge = Array.from({length: 5000}, (_, i) => ({
      name: `Category ${i} ${'x'.repeat(100)}`,
      score: 50,
      grade: 'F',
      applicable: 1,
    }));
    const text = renderPrComment({
      projectId: 'p',
      run,
      result: {
        url: run.url,
        summary: {overall: {score: 1, grade: 'F'}, categories: huge, audits: []},
      },
    });
    expect(text.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(text).toContain('(truncated)');
  });

  describe('text that came from the audited page', () => {
    const hostile = issue('x', {
      title:
        'Hi @everyone and @octocat <img src=x onerror=alert(1)> [click](http://evil.example) `code`',
      displayValue: '| fake | table |\n# heading <script>',
    });
    const text = renderPrComment({
      projectId: 'p',
      run: {...run, sha: 'abc"><script>'},
      result: {
        url: 'https://x.test/@admin',
        summary: summary(),
        comparison: {
          overallDelta: 0,
          categories: [],
          newIssues: [hostile],
          fixed: [],
          stillFailing: [],
        },
      },
    });

    it('cannot ping anyone', () => {
      expect(text).not.toMatch(BARE_AT);
      expect(text).toContain('@\u200beveryone');
    });

    it('cannot add html, links, table rows or code spans', () => {
      expect(text).not.toContain('<img');
      expect(text).not.toContain('<script');
      expect(text).not.toContain('[click](http://evil.example)');
      expect(text).toContain('\\[click\\]');
      expect(text).not.toMatch(/^\| fake/m);
      expect(text).not.toMatch(/^# heading/m);
    });

    it('does not let the commit field break out of its code span', () => {
      expect(text).toContain('commit `abc`');
    });
  });

  it('encodes parentheses and spaces in the report link', () => {
    const text = renderPrComment({
      projectId: 'p',
      run,
      reportUrl: 'https://svc.example.com/a b)(c',
      result: {url: run.url, summary: summary()},
    });
    expect(text).toContain('[Full report](https://svc.example.com/a%20b%29%28c)');
  });
});

describe('alerts', () => {
  const parts = alertParts({
    run: {url: 'https://www.example.com/', repo: 'acme/site', branch: 'main', sha: 'abcdef1234'},
    regressions: [
      {id: 'canonical-https', title: 'Canonical <!channel> & more', detail: 'it is @here'},
    ],
    reportUrl: 'https://svc.example.com/r',
  });

  it('builds plain parts', () => {
    expect(parts.title).toBe('SEO regression on https://www.example.com/');
    expect(parts.lines[0]).toBe('acme/site · main · abcdef1');
    expect(parts.link).toBe('https://svc.example.com/r');
  });

  it('neutralises Slack control sequences from page text', () => {
    const body = slackBody(parts);
    expect(body.text).toContain('Canonical &lt;!channel&gt; &amp; more');
    expect(body.text).not.toContain('<!channel>');
    expect(body.text).not.toMatch(BARE_AT);
    expect(body.text).toContain('<https://svc.example.com/r|Open the report>');
    expect(body.unfurl_links).toBe(false);
  });

  it('builds a Teams adaptive card and a legacy message card', () => {
    const adaptive = teamsBody(parts, 'adaptive');
    expect(adaptive.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(adaptive.attachments[0].content.actions[0].url).toBe('https://svc.example.com/r');
    const legacy = teamsBody(parts, 'messagecard');
    expect(legacy['@type']).toBe('MessageCard');
    expect(JSON.stringify(legacy)).not.toContain('<!channel>');
  });

  it('safe and slackSafe flatten whitespace and clip', () => {
    expect(safe('a\n\n b')).toBe('a b');
    expect(slackSafe('x'.repeat(500)).length).toBe(200);
    expect(slackSafe(undefined)).toBe('');
  });
});
