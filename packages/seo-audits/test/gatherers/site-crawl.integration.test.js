/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

// Crawls a real local HTTP site through the real `safeFetchPrefix`/`safeFetchBytes` (address policy, no
// automatic redirects, body cap), with the private-network opt-in set for the duration, a real robots.txt
// and sitemap, a real on-disk cache, and a spy server standing in for "another origin".

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {collectSiteCrawl} = require('../../src/gatherers/site-crawl.js');
const {ALLOW_PRIVATE_NETWORK_ENV} = require('../../src/lib/safe-fetch.js');
const {USER_AGENT} = require('../../src/lib/crawl-snapshot.js');

const body = (
  /** @type {string} */ title,
  /** @type {string} */ text,
  /** @type {string} */ extra = ''
) =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${text}</p>${extra}</body></html>`;

/** @type {http.Server} */
let site;
/** @type {http.Server} */
let spy;
let port = 0;
let spyPort = 0;
/** @type {Array<{url: string, userAgent: string | undefined}>} */
let hits = [];
/** @type {string[]} */
let spyHits = [];
/** @type {string} */
let cacheDir;
let savedOptIn;

const origin = () => `http://127.0.0.1:${port}`;
const url = (/** @type {string} */ p) => `${origin()}${p}`;
const env = (/** @type {Record<string, string>} */ over = {}) => ({
  [ALLOW_PRIVATE_NETWORK_ENV]: '1',
  LHCI_SEO_CRAWL_CACHE_DIR: cacheDir,
  ...over,
});
const pageHits = () => hits.filter(h => h.url !== '/robots.txt' && h.url !== '/sitemap.xml');

beforeAll(async () => {
  savedOptIn = process.env[ALLOW_PRIVATE_NETWORK_ENV];
  process.env[ALLOW_PRIVATE_NETWORK_ENV] = '1';

  spy = http.createServer((req, res) => {
    spyHits.push(/** @type {string} */ (req.url));
    res.writeHead(200);
    res.end('spy');
  });
  await new Promise(resolve => spy.listen(0, '127.0.0.1', resolve));
  spyPort = /** @type {any} */ (spy.address()).port;

  const hugeNested = '<div>'.repeat(120_000); // ~600 KB: over the 512 KiB body cap
  site = http.createServer((req, res) => {
    const p = /** @type {string} */ (req.url).split('?')[0];
    hits.push({url: p, userAgent: req.headers['user-agent']});
    const html = (/** @type {string} */ content, status = 200) => {
      res.writeHead(status, {'Content-Type': 'text/html'});
      res.end(content);
    };
    switch (p) {
      case '/robots.txt':
        res.writeHead(200, {'Content-Type': 'text/plain'});
        return res.end(`User-agent: *\nDisallow: /private/\nSitemap: ${origin()}/sitemap.xml\n`);
      case '/sitemap.xml':
        res.writeHead(200, {'Content-Type': 'application/xml'});
        return res.end(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            [`${origin()}/s1`, `${origin()}/s2`, `http://127.0.0.1:${spyPort}/from-sitemap`]
              .map(l => `<url><loc>${l}</loc></url>`)
              .join('') +
            `</urlset>`
        );
      case '/':
        return html(
          body(
            'Home',
            'Welcome to the home page of the example site',
            [
              '/a',
              '/dup1',
              '/dup2',
              '/old',
              '/private/x',
              '/doc.pdf',
              '/huge',
              `http://127.0.0.1:${spyPort}/outbound`,
              'mailto:a@b.c',
            ]
              .map(
                l =>
                  `<a href="${
                    l.startsWith('http') || l.startsWith('mailto') ? l : origin() + l
                  }">l</a>`
              )
              .join('')
          )
        );
      case '/a':
        return html(body('A', 'a completely unique page about apples'));
      case '/dup1':
        return html(body('Same', 'identical text on two different urls'));
      case '/dup2':
        return html(body('Same', 'identical text on two different urls'));
      case '/s1':
        return html(body('S1', 'sitemap page one'));
      case '/s2':
        return html(body('S2', 'sitemap page two'));
      case '/old':
        res.writeHead(301, {Location: '/new'});
        return res.end();
      case '/new':
        return html(body('New', 'the page the old url moved to'));
      case '/private/x':
        return html(body('Private', 'disallowed by robots'));
      case '/doc.pdf':
        res.writeHead(200, {'Content-Type': 'application/pdf'});
        return res.end('%PDF-1.4 fake');
      case '/huge':
        return html(`<html><head><title>Huge</title></head><body>${hugeNested}`);
      case '/hang':
        return undefined; // never answers
      default:
        return html(body('Missing', 'not found'), 404);
    }
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  port = /** @type {any} */ (site.address()).port;
});

afterAll(async () => {
  if (savedOptIn === undefined) delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
  else process.env[ALLOW_PRIVATE_NETWORK_ENV] = savedOptIn;
  for (const server of [site, spy]) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

beforeEach(() => {
  hits = [];
  spyHits = [];
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-crawl-it-'));
});
afterEach(() => {
  fs.rmSync(cacheDir, {recursive: true, force: true});
});

const links = () =>
  ['/a', '/dup1', '/dup2', '/old', '/private/x', '/doc.pdf', '/huge']
    .map(url)
    .concat([`http://127.0.0.1:${spyPort}/outbound`]);
const crawl = (/** @type {Record<string, string>} */ over = {}, auditedPath = '/') =>
  collectSiteCrawl({links: links(), renderedTextLength: 60}, url(auditedPath), {env: env(over)});
const byPath = (/** @type {any} */ artifact) =>
  Object.fromEntries(
    artifact.snapshot.pages.map((/** @type {any} */ p) => [new URL(p.url).pathname, p])
  );

describe('a real crawl of a local site', () => {
  it('crawls the audited page, its links and the sitemap, and records what each page says', async () => {
    const artifact = await crawl();
    expect(artifact.state).toBe('crawled');
    expect(artifact.auditedRenderedTextLength).toBe(60);
    const pages = byPath(artifact);
    expect(Object.keys(pages).sort()).toEqual(
      ['/', '/a', '/doc.pdf', '/dup1', '/dup2', '/huge', '/old', '/s1', '/s2'].sort()
    );
    expect(pages['/']).toMatchObject({
      status: 200,
      title: 'Home',
      source: 'audited',
      extraction: 'ok',
    });
    expect(pages['/a']).toMatchObject({title: 'A', h1: ['A'], source: 'link'});
    expect(pages['/s1']).toMatchObject({title: 'S1', source: 'sitemap'});
    expect(pages['/doc.pdf']).toMatchObject({status: 200, extraction: 'skipped-not-html'});
    expect(artifact.snapshot.robots).toEqual({state: 'present'});
  });

  it('gives identical text on two URLs the same hash, and different text a different one', async () => {
    const pages = byPath(await crawl());
    expect(pages['/dup1'].textHash).toBe(pages['/dup2'].textHash);
    expect(pages['/dup1'].textHash).not.toBe(pages['/a'].textHash);
    expect(pages['/dup1'].textLength).toBeGreaterThan(20);
  });

  it('follows a same-origin redirect and records the hop', async () => {
    const old = byPath(await crawl())['/old'];
    expect(old).toMatchObject({status: 200, title: 'New'});
    expect(old.finalUrl).toBe(url('/new'));
    expect(old.redirects).toEqual([{url: url('/old'), status: 301, location: url('/new')}]);
  });

  it('honours robots.txt: the disallowed page is not requested and is recorded as blocked', async () => {
    const artifact = await crawl();
    expect(hits.map(h => h.url)).not.toContain('/private/x');
    expect(
      artifact.snapshot.skipped.some(
        (/** @type {any} */ s) => s.reason === 'blocked-by-robots' && s.url === url('/private/x')
      )
    ).toBe(true);
  });

  it('requests the disallowed page when told to ignore robots.txt', async () => {
    const artifact = await crawl({
      LHCI_SEO_CRAWL_RESPECT_ROBOTS: '0',
      LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '0',
    });
    expect(hits.map(h => h.url)).toContain('/private/x');
    expect(byPath(artifact)['/private/x']).toMatchObject({status: 200});
    expect(artifact.snapshot.robots).toEqual({state: 'ignored'});
  });

  it('never requests another origin: the spy server receives nothing', async () => {
    const artifact = await crawl();
    expect(spyHits).toEqual([]);
    const crossOrigin = artifact.snapshot.skipped.filter(
      (/** @type {any} */ s) => s.reason === 'cross-origin'
    );
    expect(crossOrigin.map((/** @type {any} */ s) => s.url)).toEqual(
      expect.arrayContaining([
        `http://127.0.0.1:${spyPort}/outbound`,
        `http://127.0.0.1:${spyPort}/from-sitemap`,
      ])
    );
  });

  it('sends the crawler user-agent on every page request', async () => {
    await crawl();
    const pages = pageHits();
    expect(pages.length).toBeGreaterThan(5);
    for (const hit of pages) expect(hit.userAgent).toBe(USER_AGENT);
  });

  it('reads at most the body cap of a huge hostile page and still extracts it quickly', async () => {
    const started = Date.now();
    const huge = byPath(await crawl())['/huge'];
    expect(huge).toMatchObject({status: 200, truncated: true, extraction: 'ok'});
    expect(huge.bytes).toBeLessThanOrEqual(512 * 1024);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('stays within the page cap', async () => {
    const artifact = await crawl({
      LHCI_SEO_CRAWL_MAX_PAGES: '4',
      LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '0',
    });
    expect(artifact.snapshot.pages.length).toBeLessThanOrEqual(4);
    expect(pageHits().length).toBeLessThanOrEqual(4 * 3);
  });
});

describe('the on-disk cache, for real', () => {
  it('serves a second crawl of the same origin from the cache with no request to the site', async () => {
    const first = await crawl();
    expect(first.state).toBe('crawled');
    const afterFirst = hits.length;
    expect(afterFirst).toBeGreaterThan(5);

    const second = await crawl();
    expect(second.state).toBe('cached');
    expect(hits.length).toBe(afterFirst);
    expect(second.snapshot.pages.map((/** @type {any} */ p) => p.url)).toEqual(
      first.snapshot.pages.map((/** @type {any} */ p) => p.url)
    );
  });

  it('requests only the audited page when another URL of the same site is audited', async () => {
    await crawl();
    const before = hits.length;
    const other = await crawl({}, '/not-in-the-snapshot');
    expect(other.state).toBe('cached');
    expect(hits.slice(before).map(h => h.url)).toEqual(['/not-in-the-snapshot']);
    expect(other.snapshot.pages[0].url).toBe(url('/not-in-the-snapshot'));
    // A page already in the snapshot, even as the final URL of a redirect, needs no request.
    const before2 = hits.length;
    expect((await crawl({}, '/new')).state).toBe('cached');
    expect(hits.length).toBe(before2);
  });

  it('re-crawls when the cached file is corrupt, and replaces it', async () => {
    await crawl();
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    fs.writeFileSync(path.join(cacheDir, files[0]), '{corrupt', {mode: 0o600});
    const before = hits.length;
    const again = await crawl();
    expect(again.state).toBe('crawled');
    expect(hits.length).toBeGreaterThan(before);
    expect(JSON.parse(fs.readFileSync(path.join(cacheDir, files[0]), 'utf8')).version).toBe(1);
  });

  it('does not use a cache directory that is open to other users', async () => {
    if (typeof process.getuid !== 'function') return;
    fs.chmodSync(cacheDir, 0o755);
    const first = await crawl();
    const second = await crawl();
    expect(first.state).toBe('crawled');
    expect(second.state).toBe('crawled');
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });
});

describe('what the crawler does when it cannot work', () => {
  it('is unavailable, naming the setting, when the private-network opt-in is missing', async () => {
    const saved = process.env[ALLOW_PRIVATE_NETWORK_ENV];
    delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
    try {
      const artifact = await crawl({[ALLOW_PRIVATE_NETWORK_ENV]: ''});
      expect(artifact.state).toBe('unavailable');
      expect(artifact.reason).toMatch(/LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/);
      expect(hits).toEqual([]);
    } finally {
      process.env[ALLOW_PRIVATE_NETWORK_ENV] = saved;
    }
  });

  it('makes no request at all when switched off', async () => {
    const artifact = await crawl({LHCI_SEO_CRAWL: '0'});
    expect(artifact.state).toBe('disabled');
    expect(hits).toEqual([]);
  });

  it('is cut off by the time budget when the site hangs, and says so', async () => {
    const hanging = Array.from({length: 12}, (_, i) => url(`/hang?${i}`));
    const started = Date.now();
    const artifact = await collectSiteCrawl({links: hanging, renderedTextLength: 1}, url('/'), {
      env: env({LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS: '10', LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '0'}),
    });
    expect(Date.now() - started).toBeLessThan(25_000);
    expect(artifact.state).toBe('crawled');
    expect(artifact.snapshot.stats.truncatedByBudget).toBe(true);
    expect(byPath(artifact)['/']).toMatchObject({status: 200});
  }, 40_000);
});
