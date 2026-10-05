/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {crawlSite, parseConfig} = require('../../src/lib/crawler.js');
const {cacheKey, USER_AGENT, MAX_BODY_BYTES} = require('../../src/lib/crawl-snapshot.js');

const ORIGIN = 'https://example.com';
const AUDITED = `${ORIGIN}/`;
const u = (/** @type {string} */ p) => `${ORIGIN}${p}`;
const page = (title = 'T', body = '<p>hello world</p>', head = '') =>
  `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;

/**
 * A scripted site: url -> {status, body, location, contentType, headers} (or an Error).
 * @param {Record<string, any>} routes
 */
function makeSite(routes) {
  /** @type {Array<{url: string, options: any}>} */
  const requests = [];
  let clock = 0;
  const site = {
    requests,
    advance: (/** @type {number} */ ms) => {
      clock += ms;
    },
    now: () => clock,
    perRequestMs: 0,
    fetchPage: async (/** @type {string} */ url, /** @type {any} */ options) => {
      requests.push({url, options});
      clock += site.perRequestMs;
      const route = routes[url] ?? (routes.__default ? routes.__default(url) : undefined);
      if (route instanceof Error) throw route;
      // A URL the test did not script is a normal, working page.
      return response(route?.status ?? 200, route?.body ?? page(), route || {});
    },
  };
  return site;
}

/**
 * @param {number} status
 * @param {string} body
 * @param {any} [route]
 */
function response(status, body, route = {}) {
  const ok = status >= 200 && status < 300;
  const type = route.contentType ?? 'text/html; charset=utf-8';
  const html = /^text\/html|^application\/xhtml/.test(type);
  return {
    status,
    redirectLocation: route.location ?? null,
    headers: {
      'x-robots-tag': route.xRobotsTag ?? [],
      'content-type': [type],
      'content-encoding': [],
      location: route.location ? [route.location] : [],
    },
    body: ok && html ? Buffer.from(body) : Buffer.alloc(0),
    bodyRead: !ok ? 'skipped-status' : html ? 'html' : 'skipped-not-html',
    truncated: Boolean(route.truncated),
  };
}

const robots =
  (/** @type {number} */ status, /** @type {string} */ text = '') =>
  async () => ({
    status,
    redirectLocation: null,
    body: Buffer.from(text),
  });
const noSitemap = async () => ({documents: [], discovery: 'none'});
const sitemapOf = (/** @type {string[]} */ locs) => async () => ({
  discovery: 'robots-txt',
  documents: [{outcome: 'ok', kind: 'urlset', locs}],
});

/** @return {{read: jest.Mock, write: jest.Mock}} */
const fakeCache = (/** @type {any} */ cached = null) => ({
  read: jest.fn(() => cached),
  write: jest.fn(() => true),
});

/** @param {any} over */
const crawl = (site, over = {}) =>
  crawlSite({
    auditedUrl: AUDITED,
    pageLinks: [],
    fetchPage: site.fetchPage,
    fetchBytes: robots(404),
    collectSitemap: noSitemap,
    cache: fakeCache(),
    now: site.now,
    ...over,
    // The audited page's own link checks are tested on their own (below); the others count requests exactly.
    env: {
      LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '0',
      LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '0',
      ...(over.env || {}),
    },
  });
const requested = (/** @type {any} */ site) => site.requests.map((/** @type {any} */ r) => r.url);

describe('parseConfig', () => {
  it('has the documented defaults', () => {
    expect(parseConfig({})).toEqual({
      enabled: true,
      pages: 50,
      depth: 3,
      linkChecks: 100,
      externalChecks: 20,
      budgetMs: 120_000,
      robots: 'honour',
    });
  });

  it('clamps the number of external checks to 0 to 50 and ignores garbage', () => {
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '0'}).externalChecks).toBe(0);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '-1'}).externalChecks).toBe(0);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '900'}).externalChecks).toBe(50);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '7'}).externalChecks).toBe(7);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: 'lots'}).externalChecks).toBe(20);
  });

  it('clamps the number of link checks to 0 to 200 and ignores garbage', () => {
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '0'}).linkChecks).toBe(0);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '-4'}).linkChecks).toBe(0);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '5000'}).linkChecks).toBe(200);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '25'}).linkChecks).toBe(25);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_LINK_CHECKS: 'many'}).linkChecks).toBe(100);
  });

  it('clamps the depth to 1 to 5 and ignores garbage', () => {
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_DEPTH: '0'}).depth).toBe(1);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_DEPTH: '-2'}).depth).toBe(1);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_DEPTH: '99'}).depth).toBe(5);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_DEPTH: '2'}).depth).toBe(2);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_DEPTH: 'deep'}).depth).toBe(3);
  });

  it('clamps pages and the time budget, and ignores garbage', () => {
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_PAGES: '0'}).pages).toBe(1);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_PAGES: '-3'}).pages).toBe(1);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_PAGES: '99999'}).pages).toBe(200);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_PAGES: '25'}).pages).toBe(25);
    expect(parseConfig({LHCI_SEO_CRAWL_MAX_PAGES: 'lots'}).pages).toBe(50);
    expect(parseConfig({LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS: '1'}).budgetMs).toBe(10_000);
    expect(parseConfig({LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS: '5000'}).budgetMs).toBe(600_000);
    expect(parseConfig({LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS: '90'}).budgetMs).toBe(90_000);
  });

  it('turns the crawl and robots.txt off only for exactly 0 or false', () => {
    expect(parseConfig({LHCI_SEO_CRAWL: '0'}).enabled).toBe(false);
    expect(parseConfig({LHCI_SEO_CRAWL: 'false'}).enabled).toBe(false);
    for (const v of ['1', 'true', 'no', 'off', 'FALSE', '', ' 0']) {
      expect(parseConfig({LHCI_SEO_CRAWL: v}).enabled).toBe(true);
    }
    expect(parseConfig({LHCI_SEO_CRAWL_RESPECT_ROBOTS: '0'}).robots).toBe('ignore');
    expect(parseConfig({LHCI_SEO_CRAWL_RESPECT_ROBOTS: 'false'}).robots).toBe('ignore');
    expect(parseConfig({LHCI_SEO_CRAWL_RESPECT_ROBOTS: 'no'}).robots).toBe('honour');
  });
});

describe('crawlSite: switched off and bad input', () => {
  it('makes no request at all when disabled', async () => {
    const site = makeSite({});
    const fetchBytes = jest.fn(robots(200));
    const cache = fakeCache();
    const result = await crawl(site, {env: {LHCI_SEO_CRAWL: '0'}, fetchBytes, cache});
    expect(result).toMatchObject({state: 'disabled', snapshot: null});
    expect(result.reason).toMatch(/LHCI_SEO_CRAWL/);
    expect(site.requests).toEqual([]);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(cache.read).not.toHaveBeenCalled();
  });

  it('is unavailable for an audited URL that is not http(s), without throwing', async () => {
    const site = makeSite({});
    for (const bad of [
      'ftp://example.com/file',
      'ftp://example.com/',
      'file:///etc/passwd',
      '',
      undefined,
      null,
      5,
    ]) {
      const result = await crawl(site, {auditedUrl: bad});
      expect(result.state).toBe('unavailable');
    }
    expect(site.requests).toEqual([]);
  });
});

describe('crawlSite: a cold crawl', () => {
  it('requests the audited page first, then its links, and records what it found', async () => {
    const site = makeSite({
      [AUDITED]: {body: page('Home', '<h1>Welcome</h1><p>home text</p><a href="/a">a</a>')},
      [u('/a')]: {body: page('A', '<p>page a</p>')},
      [u('/b')]: {body: page('B', '<p>page b</p>')},
    });
    const cache = fakeCache();
    const result = await crawl(site, {pageLinks: [u('/a'), u('/b')], cache});

    expect(result.state).toBe('crawled');
    expect(requested(site)).toEqual([AUDITED, u('/a'), u('/b')]);
    const snap = result.snapshot;
    expect(snap.origin).toBe(ORIGIN);
    expect(snap.pages.map((/** @type {any} */ p) => [p.url, p.source, p.title])).toEqual([
      [AUDITED, 'audited', 'Home'],
      [u('/a'), 'link', 'A'],
      [u('/b'), 'link', 'B'],
    ]);
    expect(snap.pages[0]).toMatchObject({
      status: 200,
      extraction: 'ok',
      h1: ['Welcome'],
      finalUrl: AUDITED,
    });
    expect(snap.pages[0].links.map((/** @type {any} */ l) => l.url)).toEqual([u('/a')]);
    expect(snap.pages[0].textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.seeds).toEqual({audited: 1, home: 0, links: 2, sitemap: 0});
    expect(snap.robots).toEqual({state: 'absent'});
    expect(snap.bounds).toEqual({
      pages: 50,
      depth: 3,
      budgetMs: 120_000,
      robots: 'honour',
      userAgent: USER_AGENT,
    });
    expect(snap.stats.requests).toBe(4);
    expect(snap.stats.truncatedByBudget).toBe(false);
    expect(Date.parse(snap.createdAt)).not.toBeNaN();
  });

  it('sends the crawler user-agent, the body cap and the per-request timeout with every request', async () => {
    const site = makeSite({});
    await crawl(site, {pageLinks: [u('/a')]});
    for (const {options} of site.requests) {
      expect(options).toEqual({timeoutMs: 5000, maxBytes: MAX_BODY_BYTES, userAgent: USER_AGENT});
    }
  });

  it('writes the snapshot to the cache under the key for these bounds', async () => {
    const site = makeSite({});
    const cache = fakeCache();
    await crawl(site, {
      cache,
      env: {LHCI_SEO_CRAWL_CACHE_DIR: '/cache', LHCI_SEO_CRAWL_MAX_PAGES: '20'},
    });
    expect(cache.write).toHaveBeenCalledTimes(1);
    const [dir, key, snap] = cache.write.mock.calls[0];
    expect(dir).toBe('/cache');
    expect(key).toBe(
      cacheKey({origin: ORIGIN, pages: 20, depth: 3, robots: 'honour', userAgent: USER_AGENT})
    );
    expect(snap.pages).toHaveLength(1);
  });

  it('records non-HTML pages, error statuses and network failures without failing the crawl', async () => {
    const site = makeSite({
      [u('/doc.pdf')]: {contentType: 'application/pdf'},
      [u('/gone')]: {status: 404},
      [u('/boom')]: new Error('connection reset'),
    });
    const result = await crawl(site, {pageLinks: [u('/doc.pdf'), u('/gone'), u('/boom')]});
    const by = Object.fromEntries(result.snapshot.pages.map((/** @type {any} */ p) => [p.url, p]));
    expect(by[u('/doc.pdf')]).toMatchObject({
      status: 200,
      extraction: 'skipped-not-html',
      textHash: null,
    });
    expect(by[u('/gone')]).toMatchObject({status: 404, extraction: 'skipped-status'});
    expect(by[u('/boom')]).toMatchObject({status: null, extraction: 'error'});
    expect(by[AUDITED].extraction).toBe('ok');
    expect(result.state).toBe('crawled');
  });

  it('keeps the content type, a few X-Robots-Tag values, and the truncated flag', async () => {
    const site = makeSite({
      [AUDITED]: {xRobotsTag: Array.from({length: 30}, (_, i) => `noindex ${i}`), truncated: true},
    });
    const result = await crawl(site);
    const p = result.snapshot.pages[0];
    expect(p.contentType).toBe('text/html; charset=utf-8');
    expect(p.xRobotsTag).toHaveLength(10);
    expect(p.truncated).toBe(true);
  });

  it('is deterministic: the same inputs request the same URLs in the same order', async () => {
    const links = Array.from({length: 120}, (_, i) => u(`/p${i}`));
    const sitemap = Array.from({length: 300}, (_, i) => u(`/s${i}`));
    const a = makeSite({});
    const b = makeSite({});
    await crawl(a, {pageLinks: links, collectSitemap: sitemapOf(sitemap)});
    await crawl(b, {pageLinks: links, collectSitemap: sitemapOf(sitemap)});
    expect(requested(a)).toEqual(requested(b));
  });
});

describe('crawlSite: bounds', () => {
  it('never requests more pages than the cap, with more seeds than slots', async () => {
    const site = makeSite({});
    const links = Array.from({length: 200}, (_, i) => u(`/p${i}`));
    const sitemap = Array.from({length: 500}, (_, i) => u(`/s${i}`));
    const result = await crawl(site, {
      pageLinks: links,
      collectSitemap: sitemapOf(sitemap),
      env: {LHCI_SEO_CRAWL_MAX_PAGES: '10'},
    });
    expect(site.requests).toHaveLength(10);
    expect(result.snapshot.pages).toHaveLength(10);
    // Seeds take at most half of the slots after the audited page (here 3 links and 2 sitemap URLs); the
    // rest is filled by the link-following and by more sitemap URLs.
    expect(result.snapshot.seeds).toEqual({audited: 1, home: 0, links: 3, sitemap: 2});
    expect(
      result.snapshot.skipped.some((/** @type {any} */ s) => s.reason === 'over-page-cap')
    ).toBe(true);
  });

  it('gives the page links their slots first and fills the spare ones from the sitemap', async () => {
    const site = makeSite({});
    await crawl(site, {
      pageLinks: [u('/l1'), u('/l2')],
      collectSitemap: sitemapOf([u('/s1'), u('/s2'), u('/s3'), u('/s4')]),
      env: {LHCI_SEO_CRAWL_MAX_PAGES: '5'},
    });
    expect(new Set(requested(site))).toEqual(
      new Set([AUDITED, u('/l1'), u('/l2'), u('/s1'), u('/s2')])
    );
  });

  it('caps the whole listing of skipped URLs, saying how many were left out', async () => {
    const site = makeSite({});
    const huge = Array.from({length: 5000}, (_, i) => `https://other-${i}.test/x`);
    const result = await crawl(site, {pageLinks: huge});
    const skipped = result.snapshot.skipped;
    expect(skipped.length).toBeLessThanOrEqual(201);
    expect(skipped[skipped.length - 1].detail).toMatch(/more URL\(s\) not listed/);
  });

  it('marks what is left as not checked, and says so, when the time budget runs out', async () => {
    const site = makeSite({});
    site.perRequestMs = 70_000;
    const result = await crawl(site, {
      pageLinks: Array.from({length: 30}, (_, i) => u(`/p${i}`)),
      env: {LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS: '120'},
    });
    expect(result.state).toBe('crawled');
    expect(result.snapshot.stats.truncatedByBudget).toBe(true);
    expect(site.requests.length).toBeLessThan(31);
    expect(site.requests[0].url).toBe(AUDITED);
    expect(
      result.snapshot.pages.filter((/** @type {any} */ p) => p.status !== null).length
    ).toBeGreaterThan(0);
    // A URL that was never requested is a skip, not a page that "did not answer".
    expect(result.snapshot.pages.every((/** @type {any} */ p) => p.status !== null)).toBe(true);
    expect(
      result.snapshot.skipped.filter((/** @type {any} */ s) => s.reason === 'not-checked').length
    ).toBeGreaterThan(0);
  });

  it('never exceeds three requests per page when every URL redirects', async () => {
    /** @type {Record<string, any>} */
    const routes = {};
    for (let i = 0; i < 40; i++) {
      routes[u(`/r${i}`)] = {status: 301, location: u(`/r${i}-b`)};
      routes[u(`/r${i}-b`)] = {status: 301, location: u(`/r${i}-c`)};
      routes[u(`/r${i}-c`)] = {status: 301, location: u(`/r${i}-d`)};
    }
    const site = makeSite(routes);
    await crawl(site, {
      pageLinks: Array.from({length: 40}, (_, i) => u(`/r${i}`)),
      env: {LHCI_SEO_CRAWL_MAX_PAGES: '10'},
    });
    expect(site.requests.length).toBeLessThanOrEqual(30);
  });
});

describe('crawlSite: only the audited origin is ever requested', () => {
  const hostile = [
    'https://other.test/x',
    'https://example.com.evil.test/x',
    'http://example.com/x',
    'https://example.com:8443/x',
    'https://www.example.com/x',
    'https://user:pass@example.com/x',
    'http://169.254.169.254/latest/meta-data/',
    'javascript:alert(1)',
    'mailto:a@b.c',
    'file:///etc/passwd',
    '//evil.test/x',
  ];

  it('requests none of them from the page links or the sitemap', async () => {
    const site = makeSite({});
    await crawl(site, {pageLinks: hostile, collectSitemap: sitemapOf(hostile)});
    expect(requested(site)).toEqual([AUDITED]);
  });

  it('records the cross-origin ones as skipped', async () => {
    const site = makeSite({});
    const result = await crawl(site, {pageLinks: hostile});
    const crossOrigin = result.snapshot.skipped.filter(
      (/** @type {any} */ s) => s.reason === 'cross-origin'
    );
    expect(crossOrigin.length).toBeGreaterThan(3);
  });

  it('never requests a redirect target on another origin, host, port or scheme', async () => {
    const routes = {};
    hostile.slice(0, 7).forEach((target, i) => {
      routes[u(`/r${i}`)] = {status: 302, location: target};
    });
    const site = makeSite(routes);
    const result = await crawl(site, {pageLinks: hostile.slice(0, 7).map((_, i) => u(`/r${i}`))});
    for (const {url} of site.requests) expect(url.startsWith(ORIGIN + '/')).toBe(true);
    expect(requested(site)).not.toContain('http://169.254.169.254/latest/meta-data/');
    expect(
      result.snapshot.skipped.filter((/** @type {any} */ s) => s.reason === 'cross-origin').length
    ).toBeGreaterThan(0);
  });
});

describe('crawlSite: redirects within the origin', () => {
  it('follows one hop, records it, and extracts from the final page', async () => {
    const site = makeSite({
      [u('/old')]: {status: 301, location: '/new'},
      [u('/new')]: {body: page('New', '<p>moved here</p>')},
    });
    const result = await crawl(site, {pageLinks: [u('/old')]});
    const p = result.snapshot.pages.find((/** @type {any} */ x) => x.url === u('/old'));
    expect(p).toMatchObject({finalUrl: u('/new'), status: 200, title: 'New', extraction: 'ok'});
    expect(p.redirects).toEqual([{url: u('/old'), status: 301, location: u('/new')}]);
  });

  it('follows at most three rounds, then gives up on a longer chain', async () => {
    const site = makeSite({
      [u('/c0')]: {status: 301, location: u('/c1')},
      [u('/c1')]: {status: 301, location: u('/c2')},
      [u('/c2')]: {status: 301, location: u('/c3')},
      [u('/c3')]: {status: 301, location: u('/c4')},
      [u('/c4')]: {status: 301, location: u('/c5')},
      [u('/c5')]: {body: page('end')},
    });
    const result = await crawl(site, {pageLinks: [u('/c0')]});
    expect(requested(site)).not.toContain(u('/c5'));
    expect(
      result.snapshot.skipped.some((/** @type {any} */ s) => s.detail === 'too many redirects')
    ).toBe(true);
  });

  it('stops a redirect loop at the first repeated URL', async () => {
    const site = makeSite({
      [u('/a')]: {status: 302, location: u('/b')},
      [u('/b')]: {status: 302, location: u('/a')},
    });
    const result = await crawl(site, {pageLinks: [u('/a')]});
    expect(requested(site).filter(url => url === u('/a'))).toHaveLength(1);
    expect(
      result.snapshot.skipped.some((/** @type {any} */ s) => /already requested/.test(s.detail))
    ).toBe(true);
  });

  it('does not follow a redirect to a URL robots.txt disallows', async () => {
    const site = makeSite({[u('/go')]: {status: 301, location: u('/private/x')}});
    const result = await crawl(site, {
      pageLinks: [u('/go')],
      fetchBytes: robots(200, 'User-agent: *\nDisallow: /private/'),
    });
    expect(requested(site)).not.toContain(u('/private/x'));
    expect(
      result.snapshot.skipped.some((/** @type {any} */ s) => s.reason === 'blocked-by-robots')
    ).toBe(true);
  });

  it('records a redirect with a missing or unusable Location without following it', async () => {
    const site = makeSite({
      [u('/none')]: {status: 301},
      [u('/bad')]: {status: 301, location: 'http://[bad'},
      [u('/scheme')]: {status: 301, location: 'javascript:alert(1)'},
    });
    const result = await crawl(site, {pageLinks: [u('/none'), u('/bad'), u('/scheme')]});
    expect(site.requests).toHaveLength(4);
    expect(result.state).toBe('crawled');
  });

  it('does not request the same page twice when two seeds redirect to it', async () => {
    const site = makeSite({
      [u('/one')]: {status: 301, location: u('/target')},
      [u('/two')]: {status: 301, location: u('/target')},
      [u('/target')]: {body: page('T')},
    });
    await crawl(site, {pageLinks: [u('/one'), u('/two')]});
    expect(requested(site).filter(url => url === u('/target'))).toHaveLength(1);
  });
});

describe('crawlSite: robots.txt', () => {
  const rules =
    'User-agent: *\nDisallow: /private/\n\nUser-agent: lhci-seo-audits-crawler\nDisallow: /crawler-only/\n';

  it('does not request a disallowed URL from the links or the sitemap, and records it as blocked', async () => {
    const site = makeSite({});
    const result = await crawl(site, {
      pageLinks: [u('/ok'), u('/private/a')],
      collectSitemap: sitemapOf([u('/private/b'), u('/ok2')]),
      fetchBytes: robots(200, 'User-agent: *\nDisallow: /private/'),
    });
    expect(requested(site)).not.toContain(u('/private/a'));
    expect(requested(site)).not.toContain(u('/private/b'));
    expect(requested(site)).toEqual(expect.arrayContaining([AUDITED, u('/ok'), u('/ok2')]));
    expect(result.snapshot.robots).toEqual({state: 'present'});
    const blocked = result.snapshot.skipped
      .filter((/** @type {any} */ s) => s.reason === 'blocked-by-robots')
      .map((/** @type {any} */ s) => s.url);
    expect(blocked).toEqual(expect.arrayContaining([u('/private/a'), u('/private/b')]));
  });

  it('uses the group for the crawler own user-agent when there is one', async () => {
    const site = makeSite({});
    await crawl(site, {
      pageLinks: [u('/crawler-only/x'), u('/private/y')],
      fetchBytes: robots(200, rules),
    });
    expect(requested(site)).not.toContain(u('/crawler-only/x'));
    expect(requested(site)).toContain(u('/private/y'));
  });

  it('always requests the audited page, even if robots.txt disallows it', async () => {
    const site = makeSite({});
    const result = await crawl(site, {
      auditedUrl: u('/private/page'),
      fetchBytes: robots(200, 'User-agent: *\nDisallow: /'),
    });
    expect(requested(site)).toEqual([u('/private/page')]);
    expect(result.state).toBe('crawled');
  });

  it('requests everything, without even fetching robots.txt, when told to ignore it', async () => {
    const site = makeSite({});
    const fetchBytes = jest.fn(robots(200, 'User-agent: *\nDisallow: /'));
    const result = await crawl(site, {
      pageLinks: [u('/private/a')],
      fetchBytes,
      env: {LHCI_SEO_CRAWL_RESPECT_ROBOTS: '0'},
    });
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(requested(site)).toContain(u('/private/a'));
    expect(result.snapshot.robots).toEqual({state: 'ignored'});
    expect(result.snapshot.bounds.robots).toBe('ignore');
  });

  it('treats a 4xx robots.txt as no restrictions', async () => {
    const site = makeSite({});
    const result = await crawl(site, {pageLinks: [u('/private/a')], fetchBytes: robots(404)});
    expect(requested(site)).toContain(u('/private/a'));
    expect(result.snapshot.robots).toEqual({state: 'absent'});
  });

  it.each([
    ['a 503', robots(503)],
    ['a redirect', robots(301)],
    [
      'a network error',
      async () => {
        throw new Error('socket hang up');
      },
    ],
  ])(
    'requests only the audited page, and does not cache, when robots.txt is %s',
    async (_name, fetchBytes) => {
      const site = makeSite({});
      const cache = fakeCache();
      const sitemap = jest.fn(sitemapOf([u('/s1')]));
      const result = await crawl(site, {
        pageLinks: [u('/a'), u('/b')],
        fetchBytes,
        collectSitemap: sitemap,
        cache,
      });
      expect(requested(site)).toEqual([AUDITED]);
      expect(sitemap).not.toHaveBeenCalled();
      expect(result.snapshot.robots).toEqual({state: 'unavailable'});
      expect(
        result.snapshot.skipped.some((/** @type {any} */ s) =>
          /robots.txt could not be read/.test(s.detail)
        )
      ).toBe(true);
      expect(cache.write).not.toHaveBeenCalled();
    }
  );
});

describe('crawlSite: robots.txt identifies the crawler', () => {
  it('sends the crawler user-agent with the robots.txt request, keeping its limits', async () => {
    const fetchBytes = jest.fn(robots(404));
    await crawl(makeSite({}), {fetchBytes});
    const call = fetchBytes.mock.calls.find(([url]) => url.endsWith('/robots.txt'));
    expect(call[1]).toMatchObject({userAgent: USER_AGENT});
    expect(call[1].timeoutMs).toBeGreaterThan(0);
    expect(call[1].maxBytes).toBeGreaterThan(0);
  });
});

const linksTo = (/** @type {string[]} */ paths) =>
  paths.map(path => `<a href="${path}">${path}</a>`).join('');
const depthsOf = (/** @type {any} */ result) =>
  Object.fromEntries(result.snapshot.pages.map((/** @type {any} */ p) => [p.url, p.depth]));

describe('crawlSite: link-following', () => {
  /** A chain: / -> /a -> /b -> /c -> /d -> /e. */
  const chain = () =>
    makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/a']))},
      [u('/a')]: {body: page('A', linksTo(['/b']))},
      [u('/b')]: {body: page('B', linksTo(['/c']))},
      [u('/c')]: {body: page('C', linksTo(['/d']))},
      [u('/d')]: {body: page('D', linksTo(['/e']))},
    });

  it('follows links for three hops by default, records each page depth, and says the crawl was cut by depth', async () => {
    const site = chain();
    const result = await crawl(site);
    expect(requested(site)).toEqual([AUDITED, u('/a'), u('/b'), u('/c')]);
    expect(depthsOf(result)).toEqual({[AUDITED]: 0, [u('/a')]: 1, [u('/b')]: 2, [u('/c')]: 3});
    expect(result.snapshot.stats.cutByDepth).toBe(true);
    expect(result.snapshot.stats.overPageCap).toBe(false);
    expect(result.snapshot.bounds.depth).toBe(3);
  });

  it('follows as far as LHCI_SEO_CRAWL_MAX_DEPTH says, and is not cut when nothing is left', async () => {
    const one = await crawl(chain(), {env: {LHCI_SEO_CRAWL_MAX_DEPTH: '1'}});
    expect(Object.keys(depthsOf(one))).toEqual([AUDITED, u('/a')]);
    expect(one.snapshot.stats.cutByDepth).toBe(true);
    const five = await crawl(chain(), {env: {LHCI_SEO_CRAWL_MAX_DEPTH: '5'}});
    expect(Object.keys(depthsOf(five))).toHaveLength(6);
    expect(five.snapshot.stats.cutByDepth).toBe(false);
  });

  it('is not cut by depth on a site it has fully crawled', async () => {
    const site = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/a', '/b']))},
      [u('/a')]: {body: page('A', linksTo(['/b', '/']))},
    });
    const result = await crawl(site);
    expect(result.snapshot.pages).toHaveLength(3);
    expect(result.snapshot.stats).toMatchObject({cutByDepth: false, overPageCap: false});
  });

  it('crawls shallower pages before deeper ones, so the page cap leaves out the deepest', async () => {
    const site = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/a', '/b', '/c']))},
      [u('/a')]: {body: page('A', linksTo(['/a1', '/a2']))},
      [u('/b')]: {body: page('B', linksTo(['/b1', '/b2']))},
      [u('/c')]: {body: page('C', linksTo(['/c1', '/c2']))},
    });
    const result = await crawl(site, {env: {LHCI_SEO_CRAWL_MAX_PAGES: '6'}});
    const depths = depthsOf(result);
    // 1 + 3 pages at depth 1, then 2 of the 6 pages at depth 2.
    expect(Object.values(depths).filter(d => d === 1)).toHaveLength(3);
    expect(Object.values(depths).filter(d => d === 2)).toHaveLength(2);
    expect(result.snapshot.pages).toHaveLength(6);
    expect(result.snapshot.stats.overPageCap).toBe(true);
    expect(
      result.snapshot.skipped.filter((/** @type {any} */ s) => s.reason === 'over-page-cap')
    ).toHaveLength(4);
  });

  it('requests the homepage as a second seed when the audited page is deeper', async () => {
    const deep = u('/blog/post');
    const site = makeSite({
      [deep]: {body: page('Post', '<p>post</p>')},
      [AUDITED]: {body: page('Home', linksTo(['/about']))},
    });
    const result = await crawl(site, {auditedUrl: deep});
    expect(requested(site).slice(0, 2)).toEqual([deep, AUDITED]);
    expect(result.snapshot.pages.map((/** @type {any} */ p) => [p.url, p.source, p.depth])).toEqual(
      [
        [deep, 'audited', 0],
        [AUDITED, 'home', 0],
        [u('/about'), 'link', 1],
      ]
    );
    expect(result.snapshot.seeds.home).toBe(1);
  });

  it('does not request the homepage twice when it is the audited page', async () => {
    const site = makeSite({});
    await crawl(site);
    expect(requested(site).filter(url => url === AUDITED)).toHaveLength(1);
  });

  it('records a homepage that robots.txt disallows instead of requesting it', async () => {
    const deep = u('/blog/post');
    const site = makeSite({});
    const result = await crawl(site, {
      auditedUrl: deep,
      fetchBytes: robots(200, 'User-agent: *\nDisallow: /$'),
    });
    expect(requested(site)).toEqual([deep]);
    expect(result.snapshot.seeds.home).toBe(0);
    expect(
      result.snapshot.skipped.some(
        (/** @type {any} */ s) => s.reason === 'blocked-by-robots' && s.url === AUDITED
      )
    ).toBe(true);
  });

  it('gives sitemap seeds depth 0 and the audited page’s own links depth 1', async () => {
    const site = makeSite({});
    const result = await crawl(site, {
      pageLinks: [u('/l1')],
      collectSitemap: sitemapOf([u('/s1')]),
    });
    expect(depthsOf(result)).toEqual({[AUDITED]: 0, [u('/l1')]: 1, [u('/s1')]: 0});
  });

  it('does not follow a link robots.txt disallows, and records it', async () => {
    const site = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/ok', '/private/x']))},
    });
    const result = await crawl(site, {
      fetchBytes: robots(200, 'User-agent: *\nDisallow: /private/'),
    });
    expect(requested(site)).toEqual([AUDITED, u('/ok')]);
    expect(
      result.snapshot.skipped.some(
        (/** @type {any} */ s) => s.reason === 'blocked-by-robots' && s.url === u('/private/x')
      )
    ).toBe(true);
  });

  it('never requests another origin, whatever the pages link to', async () => {
    const site = makeSite({
      [AUDITED]: {
        body: page(
          'Home',
          '<a href="https://evil.test/x">e</a><a href="http://example.com/x">scheme</a><a href="https://sub.example.com/">sub</a><a href="/ok">ok</a>'
        ),
      },
    });
    await crawl(site);
    expect(requested(site)).toEqual([AUDITED, u('/ok')]);
  });

  it('does not spend page slots on files, and records them', async () => {
    const site = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/logo.PNG', '/guide.pdf', '/page', '/app.js?v=2']))},
    });
    const result = await crawl(site);
    expect(requested(site)).toEqual([AUDITED, u('/page')]);
    expect(
      result.snapshot.skipped
        .filter((/** @type {any} */ s) => s.reason === 'not-a-page')
        .map((/** @type {any} */ s) => s.url)
    ).toEqual([u('/logo.PNG'), u('/guide.pdf'), u('/app.js?v=2')]);
  });

  it('stops following at five query-string variants of one path, and records the rest', async () => {
    const paths = Array.from({length: 12}, (_, i) => `/list?page=${i + 1}`);
    const site = makeSite({[AUDITED]: {body: page('Home', linksTo([...paths, '/list']))}});
    const result = await crawl(site);
    const listRequests = requested(site).filter(url => url.includes('/list'));
    expect(listRequests).toHaveLength(6); // /list itself and five variants
    expect(
      result.snapshot.skipped.filter((/** @type {any} */ s) => s.reason === 'query-variants')
    ).toHaveLength(7);
  });

  it('does not follow anything when robots.txt cannot be read: only the audited page is requested', async () => {
    const site = makeSite({[AUDITED]: {body: page('Home', linksTo(['/a']))}});
    const result = await crawl(site, {fetchBytes: robots(503)});
    expect(requested(site)).toEqual([AUDITED]);
    expect(result.snapshot.pages).toHaveLength(1);
  });

  it('does not follow links of a page that was not read as HTML or answered with an error', async () => {
    const site = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/gone', '/doc']))},
      [u('/gone')]: {status: 404},
      [u('/doc')]: {contentType: 'application/pdf'},
    });
    const result = await crawl(site);
    expect(requested(site)).toEqual([AUDITED, u('/gone'), u('/doc')]);
    expect(result.snapshot.pages).toHaveLength(3);
  });

  it('fills slots the link-following leaves spare with the sitemap’s remaining URLs', async () => {
    const site = makeSite({});
    const sitemap = Array.from({length: 30}, (_, i) => u(`/s${i}`));
    const result = await crawl(site, {
      collectSitemap: sitemapOf(sitemap),
      env: {LHCI_SEO_CRAWL_MAX_PAGES: '10'},
    });
    expect(result.snapshot.pages).toHaveLength(10);
    expect(result.snapshot.stats.overPageCap).toBe(true);
    expect(result.snapshot.sitemapUrls).toEqual(sitemap);
  });

  it('keeps the sitemap URL list: same-origin only, normalised, without duplicates', async () => {
    const site = makeSite({});
    const result = await crawl(site, {
      collectSitemap: sitemapOf([
        u('/a#frag'),
        u('/a'),
        'https://other.test/x',
        u('/b'),
        'ftp://example.com/file',
      ]),
    });
    expect(result.snapshot.sitemapUrls).toEqual([u('/a'), u('/b')]);
  });

  it('stays inside the page and request caps against a site that links to endless new pages', async () => {
    let n = 0;
    const site = makeSite({
      __default: () => ({body: page('T', linksTo(Array.from({length: 40}, () => `/t/${n++}`)))}),
    });
    const result = await crawl(site, {env: {LHCI_SEO_CRAWL_MAX_PAGES: '30'}});
    expect(result.snapshot.pages.length).toBeLessThanOrEqual(30);
    expect(site.requests.length).toBeLessThanOrEqual(90);
    expect(result.snapshot.stats.overPageCap).toBe(true);
  });

  it('stops following when the time budget runs out and says so', async () => {
    const site = makeSite({
      __default: (/** @type {string} */ url) => ({
        body: page(url, linksTo([`${new URL(url).pathname}x`, `${new URL(url).pathname}y`])),
      }),
    });
    site.perRequestMs = 40_000;
    const result = await crawl(site, {env: {LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS: '100'}});
    expect(result.snapshot.stats.truncatedByBudget).toBe(true);
    expect(result.snapshot.pages.length).toBeLessThan(10);
  });

  it('keeps at most 500 distinct external links across the snapshot', async () => {
    let pageNumber = 0;
    const site = makeSite({
      __default: () => {
        const base = pageNumber++ * 20;
        const external = Array.from(
          {length: 20},
          (_, i) => `<a href="https://o${base + i}.test/">x</a>`
        ).join('');
        return {body: page('T', external + linksTo([`/n${pageNumber}`]))};
      },
    });
    const result = await crawl(site, {
      env: {LHCI_SEO_CRAWL_MAX_PAGES: '40', LHCI_SEO_CRAWL_MAX_DEPTH: '5'},
    });
    const all = result.snapshot.pages.flatMap((/** @type {any} */ p) =>
      p.externalLinks.map((/** @type {any} */ l) => l.url)
    );
    expect(new Set(all).size).toBeLessThanOrEqual(500);
    expect(all.length).toBeLessThanOrEqual(500);
  });

  it('uses a different cache key for a different depth', async () => {
    const cache = fakeCache();
    await crawl(makeSite({}), {cache, env: {LHCI_SEO_CRAWL_CACHE_DIR: '/c'}});
    await crawl(makeSite({}), {
      cache: cache,
      env: {LHCI_SEO_CRAWL_CACHE_DIR: '/c', LHCI_SEO_CRAWL_MAX_DEPTH: '2'},
    });
    const keys = cache.read.mock.calls.map(([, key]) => key);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('crawlSite: status checks of the audited page’s own links', () => {
  const withChecks = (/** @type {any} */ extra = {}) => ({
    ...extra,
    env: {
      LHCI_SEO_CRAWL_MAX_PAGES: '2',
      LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '100',
      ...(extra.env || {}),
    },
  });
  /** A home page that links to eight pages, crawled with a cap that leaves most of them unread. */
  const site = (/** @type {any} */ routes = {}) =>
    makeSite({
      [AUDITED]: {body: page('Home', linksTo(Array.from({length: 8}, (_, i) => `/l${i}`)))},
      ...routes,
    });
  const checked = (/** @type {any} */ result) =>
    Object.fromEntries(result.linkChecks.checked.map((/** @type {any} */ c) => [c.url, c]));

  it('checks the links of the audited page that the crawl did not read, status only', async () => {
    const s = site({[u('/l5')]: {status: 404}, [u('/l6')]: {status: 500}});
    const result = await crawl(s, withChecks({fetchBytes: robots(404)}));
    const crawledUrls = result.snapshot.pages.map((/** @type {any} */ p) => p.url);
    const byUrl = checked(result);
    // Every link is either in the snapshot or checked, and none twice.
    const all = [...crawledUrls, ...Object.keys(byUrl)];
    for (let i = 0; i < 8; i++) expect(all.filter(url => url === u(`/l${i}`))).toHaveLength(1);
    expect(byUrl[u('/l5')] ? byUrl[u('/l5')].status : 404).toBe(404);
    expect(result.linkChecks.notChecked).toBe(0);
    for (const request of s.requests.filter((/** @type {any} */ r) => byUrl[r.url])) {
      expect(request.options.maxBytes).toBe(2048);
      expect(request.options.userAgent).toBe(USER_AGENT);
    }
  });

  it('records a redirect and follows a chain, with the hops', async () => {
    const s = site({
      [u('/l0')]: {status: 301, location: '/l1x'},
      [u('/l1x')]: {status: 302, location: '/l2x'},
      [u('/l2x')]: {body: page('End')},
    });
    const result = await crawl(s, withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '1'}}));
    const c = checked(result)[u('/l0')];
    expect(c.status).toBe(200);
    expect(c.finalUrl).toBe(u('/l2x'));
    expect(c.redirects.map((/** @type {any} */ hop) => [hop.status, hop.location])).toEqual([
      [301, u('/l1x')],
      [302, u('/l2x')],
    ]);
  });

  it('also checks the rel=next and rel=prev targets of the audited page, which are not in its link list', async () => {
    const s = makeSite({
      [AUDITED]: {
        body: page(
          'Home',
          '<p>listing</p>',
          '<link rel="next" href="/list?page=2"><link rel="prev" href="/list?page=0">'
        ),
      },
      [u('/list?page=0')]: {status: 404},
    });
    const result = await crawl(s, withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '1'}}));
    const byUrl = checked(result);
    expect(byUrl[u('/list?page=2')]).toMatchObject({status: 200});
    expect(byUrl[u('/list?page=0')]).toMatchObject({status: 404});
  });

  it('follows two checked links that redirect to the same place each to its end', async () => {
    const s = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/a', '/b']))},
      [u('/a')]: {status: 301, location: '/dest'},
      [u('/b')]: {status: 302, location: '/dest'},
      [u('/dest')]: {body: page('Dest')},
    });
    const result = await crawl(s, withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '1'}}));
    expect(checked(result)[u('/a')]).toMatchObject({status: 200, finalUrl: u('/dest')});
    expect(checked(result)[u('/b')]).toMatchObject({status: 200, finalUrl: u('/dest')});
  });

  it('shows a redirect loop among checked links as a repeated URL, within the redirect rounds', async () => {
    const s = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/a']))},
      [u('/a')]: {status: 301, location: '/b'},
      [u('/b')]: {status: 301, location: '/a'},
    });
    const result = await crawl(s, withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '1'}}));
    const hops = checked(result)[u('/a')].redirects.map((/** @type {any} */ h) => h.location);
    expect(hops.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hops).size).toBeLessThan(hops.length + 1);
    expect(s.requests.length).toBeLessThanOrEqual(1 + 3 + 3);
  });

  it('does not report a link it never got to request as unanswered when the time budget runs out', async () => {
    const s = site();
    s.perRequestMs = 12_000;
    const result = await crawl(
      s,
      withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '1', LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '8'}})
    );
    const asked = new Set(s.requests.map((/** @type {any} */ r) => r.url));
    // Every recorded check is a URL that was really requested; the rest are counted as not checked.
    for (const c of result.linkChecks.checked) expect(asked.has(c.url)).toBe(true);
    expect(result.linkChecks.checked.length + result.linkChecks.notChecked).toBe(8);
    expect(result.linkChecks.notChecked).toBeGreaterThan(0);
  });

  it('also checks links that only the rendered page has (the live DOM), once', async () => {
    const s = makeSite({[AUDITED]: {body: page('Home', '<p>no links in the server HTML</p>')}});
    const result = await crawl(s, withChecks({pageLinks: [u('/js1'), u('/js1'), u('/js2')]}));
    const all = [
      ...result.snapshot.pages.map((/** @type {any} */ p) => p.url),
      ...result.linkChecks.checked.map((/** @type {any} */ c) => c.url),
    ];
    expect(all.filter(url => url === u('/js1'))).toHaveLength(1);
    expect(all).toContain(u('/js2'));
  });

  it('stops at the configured number and says how many it left unchecked', async () => {
    const s = site();
    const result = await crawl(
      s,
      withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '1', LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '3'}})
    );
    expect(result.linkChecks.checked).toHaveLength(3);
    expect(result.linkChecks.notChecked).toBe(5);
  });

  it('records a link robots.txt disallows instead of requesting it', async () => {
    const s = makeSite({
      [AUDITED]: {body: page('Home', linksTo(['/private/x', '/ok']))},
    });
    const result = await crawl(
      s,
      withChecks({
        fetchBytes: robots(200, 'User-agent: *\nDisallow: /private/'),
        env: {LHCI_SEO_CRAWL_MAX_PAGES: '1'},
      })
    );
    expect(requested(s)).not.toContain(u('/private/x'));
    expect(checked(result)[u('/private/x')]).toMatchObject({
      status: null,
      state: 'blocked-by-robots',
    });
    expect(checked(result)[u('/ok')]).toMatchObject({status: 200, state: 'checked'});
  });

  it('claims nothing, and requests nothing, when robots.txt cannot be read', async () => {
    const s = site();
    const result = await crawl(s, withChecks({fetchBytes: robots(503)}));
    expect(requested(s)).toEqual([AUDITED]);
    expect(result.linkChecks).toEqual({checked: [], notChecked: 8});
  });

  it('does not request a link the snapshot already knows, the page itself, or another origin', async () => {
    const s = makeSite({
      [AUDITED]: {
        body: page('Home', linksTo(['/', '/known', '/new', 'https://evil.test/x', 'mailto:a@b.c'])),
      },
    });
    await crawl(s, withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '2'}, pageLinks: [u('/known')]}));
    expect(requested(s).filter(url => url === AUDITED)).toHaveLength(1);
    expect(requested(s).some(url => url.includes('evil.test'))).toBe(false);
    expect(
      requested(s).filter(url => url === u('/known')).length +
        requested(s).filter(url => url === u('/new')).length
    ).toBe(2);
  });

  it('is off when set to 0: no field, no extra requests', async () => {
    const s = site();
    const result = await crawl(s, {
      env: {LHCI_SEO_CRAWL_MAX_PAGES: '2', LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '0'},
    });
    expect(result.linkChecks).toBeNull();
    expect(s.requests).toHaveLength(2);
  });

  it('still checks the audited page’s links when the snapshot came from the cache', async () => {
    const s = site();
    const first = await crawl(s, {
      env: {LHCI_SEO_CRAWL_MAX_PAGES: '2', LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '0'},
    });
    const cache = fakeCache(first.snapshot);
    const second = await crawl(
      s,
      withChecks({cache, env: {LHCI_SEO_CRAWL_CACHE_DIR: '/c', LHCI_SEO_CRAWL_MAX_PAGES: '2'}})
    );
    expect(second.state).toBe('cached');
    expect(second.linkChecks.checked.length).toBeGreaterThan(0);
  });

  it('has no checks when the crawl is disabled or unavailable', async () => {
    const s = site();
    expect((await crawl(s, {env: {LHCI_SEO_CRAWL: '0'}})).linkChecks).toBeNull();
    expect((await crawl(s, {auditedUrl: 'ftp://x/y'})).linkChecks).toBeNull();
  });

  it('records a target that cannot be reached as unanswered, and never throws', async () => {
    const s = site({[u('/l5')]: new Error('socket hang up')});
    const result = await crawl(s, withChecks({env: {LHCI_SEO_CRAWL_MAX_PAGES: '1'}}));
    expect(checked(result)[u('/l5')].status).toBeNull();
  });
});

describe('crawlSite: status checks of the external links on the audited page', () => {
  const externalPage = (/** @type {string[]} */ urls) =>
    page('Home', urls.map(u2 => `<a href="${u2}">${u2}</a>`).join(' '));
  /** @param {string[]} calls */
  const fetchExternal = calls =>
    jest.fn(async (/** @type {string} */ url) => {
      calls.push(url);
      return {
        status: url.includes('gone') ? 404 : 200,
        redirectLocation: null,
        headers: {},
        body: Buffer.alloc(0),
        bodyRead: 'skipped-status',
        truncated: false,
      };
    });
  const withExternal = (/** @type {any} */ extra = {}) => ({
    ...extra,
    env: {LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '20', ...(extra.env || {})},
  });

  it('checks the external links of the audited page through the injected fetch, and nothing else', async () => {
    const calls = /** @type {string[]} */ ([]);
    const s = makeSite({
      [AUDITED]: {body: externalPage(['https://a.test/ok', 'https://b.test/gone', '/inside'])},
      [u('/inside')]: {body: externalPage(['https://never-checked.test/x'])},
    });
    const result = await crawl(s, withExternal({fetchExternal: fetchExternal(calls)}));
    expect(calls.sort()).toEqual(['https://a.test/ok', 'https://b.test/gone']);
    expect(
      result.externalChecks.checked.map((/** @type {any} */ c) => [c.url, c.status]).sort()
    ).toEqual([
      ['https://a.test/ok', 200],
      ['https://b.test/gone', 404],
    ]);
    // No request to another site goes through the audited site's fetch.
    expect(requested(s).some((/** @type {string} */ url) => url.includes('.test'))).toBe(false);
  });

  it('is off when set to 0: no field and no request', async () => {
    const calls = /** @type {string[]} */ ([]);
    const s = makeSite({[AUDITED]: {body: externalPage(['https://a.test/x'])}});
    const result = await crawl(s, {fetchExternal: fetchExternal(calls)});
    expect(result.externalChecks).toBeNull();
    expect(calls).toEqual([]);
  });

  it('honours the configured number, counting the rest as not checked', async () => {
    const calls = /** @type {string[]} */ ([]);
    const urls = Array.from({length: 6}, (_, i) => `https://h${i}.test/`);
    const s = makeSite({[AUDITED]: {body: externalPage(urls)}});
    const result = await crawl(
      s,
      withExternal({
        fetchExternal: fetchExternal(calls),
        env: {LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '2'},
      })
    );
    expect(result.externalChecks.checked).toHaveLength(2);
    expect(result.externalChecks.notChecked).toBe(4);
  });

  it('runs for a snapshot that came from the cache too, and not when the crawl is off', async () => {
    const calls = /** @type {string[]} */ ([]);
    const s = makeSite({[AUDITED]: {body: externalPage(['https://a.test/x'])}});
    const first = await crawl(s, {});
    const cached = await crawl(
      s,
      withExternal({
        cache: fakeCache(first.snapshot),
        fetchExternal: fetchExternal(calls),
        env: {LHCI_SEO_CRAWL_CACHE_DIR: '/c'},
      })
    );
    expect(cached.state).toBe('cached');
    expect(calls).toEqual(['https://a.test/x']);
    const off = await crawl(
      s,
      withExternal({fetchExternal: fetchExternal(calls), env: {LHCI_SEO_CRAWL: '0'}})
    );
    expect(off.externalChecks).toBeNull();
  });

  it('survives a fetch that throws and a page with no external links', async () => {
    const s = makeSite({[AUDITED]: {body: externalPage(['https://a.test/x'])}});
    const boom = jest.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await crawl(s, withExternal({fetchExternal: boom}));
    expect(result.externalChecks.checked[0]).toMatchObject({status: null, error: 'OTHER'});
    const none = await crawl(makeSite({}), withExternal({fetchExternal: boom}));
    expect(none.externalChecks).toEqual({checked: [], notChecked: 0});
  });
});

describe('crawlSite: the sitemap', () => {
  it('asks the Phase 4 discovery for the URLs, with the page sample switched off', async () => {
    const site = makeSite({});
    const collectSitemap = jest.fn(sitemapOf([u('/s1')]));
    const fetchBytes = jest.fn(robots(404));
    await crawl(site, {collectSitemap, fetchBytes, env: {SOME: 'x'}});
    const [urlArg, deps] = collectSitemap.mock.calls[0];
    expect(urlArg).toEqual({finalDisplayedUrl: AUDITED});
    // The sitemap files are fetched through the same identified fetch as robots.txt.
    await deps.fetchBytes('https://example.com/sitemap.xml', {timeoutMs: 1});
    expect(fetchBytes).toHaveBeenLastCalledWith('https://example.com/sitemap.xml', {
      timeoutMs: 1,
      userAgent: USER_AGENT,
    });
    await expect(deps.fetchPage('https://example.com/x')).rejects.toThrow(
      /does not use the sitemap page sample/
    );
  });

  it('survives a failing or odd sitemap result', async () => {
    for (const collectSitemap of [
      async () => {
        throw new Error('boom');
      },
      async () => ({documents: [{outcome: 'error', kind: 'urlset', locs: [u('/x')]}]}),
      async () => ({documents: [{outcome: 'ok', kind: 'index', locs: [u('/y')]}]}),
      async () => ({}),
    ]) {
      const site = makeSite({});
      const result = await crawl(site, {collectSitemap});
      expect(result.state).toBe('crawled');
      expect(requested(site)).toEqual([AUDITED]);
    }
  });

  it('counts a URL listed by both the page and the sitemap once, as a link', async () => {
    const site = makeSite({});
    const result = await crawl(site, {
      pageLinks: [u('/both')],
      collectSitemap: sitemapOf([u('/both'), u('/only-sitemap')]),
    });
    expect(requested(site).filter(url => url === u('/both'))).toHaveLength(1);
    const by = Object.fromEntries(
      result.snapshot.pages.map((/** @type {any} */ p) => [p.url, p.source])
    );
    expect(by[u('/both')]).toBe('link');
    expect(by[u('/only-sitemap')]).toBe('sitemap');
  });
});

describe('crawlSite: the cache', () => {
  const cachedSnapshot = (/** @type {any[]} */ pages) => ({
    version: 1,
    origin: ORIGIN,
    createdAt: new Date(0).toISOString(),
    bounds: {pages: 50, budgetMs: 120000, robots: 'honour', userAgent: USER_AGENT},
    robots: {state: 'present'},
    seeds: {audited: 1, links: 0, sitemap: 0},
    pages,
    skipped: [],
    stats: {requests: 4, elapsedMs: 10, truncatedByBudget: false},
  });
  const cachedPage = (/** @type {string} */ url) => ({
    url,
    finalUrl: url,
    redirects: [],
    status: 200,
    contentType: 'text/html',
    bytes: 1,
    truncated: false,
    title: 'cached',
    description: null,
    canonicals: [],
    robotsMetas: [],
    xRobotsTag: [],
    h1: [],
    textHash: 'abc',
    textLength: 1,
    wordCount: 1,
    links: [],
    source: 'link',
    extraction: 'ok',
  });

  it('reuses a fresh snapshot that contains the audited page with no request at all', async () => {
    const site = makeSite({});
    const fetchBytes = jest.fn(robots(200));
    const sitemap = jest.fn(noSitemap);
    const snap = cachedSnapshot([cachedPage(AUDITED), cachedPage(u('/a'))]);
    const cache = fakeCache(snap);
    const result = await crawl(site, {cache, fetchBytes, collectSitemap: sitemap});
    expect(result).toMatchObject({state: 'cached', snapshot: snap});
    expect(site.requests).toEqual([]);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(sitemap).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
  });

  it('asks the cache for the key of this origin and these bounds, with the TTL', async () => {
    const cache = fakeCache(cachedSnapshot([cachedPage(AUDITED)]));
    await crawl(makeSite({}), {
      cache,
      env: {
        LHCI_SEO_CRAWL_CACHE_DIR: '/c',
        LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '30',
        LHCI_SEO_CRAWL_MAX_PAGES: '7',
      },
    });
    const [dir, key, options] = cache.read.mock.calls[0];
    expect(dir).toBe('/c');
    expect(key).toBe(
      cacheKey({origin: ORIGIN, pages: 7, depth: 3, robots: 'honour', userAgent: USER_AGENT})
    );
    expect(options.ttlMs).toBe(30_000);
  });

  it('requests only the audited page when the cached snapshot does not contain it, and adds it', async () => {
    const site = makeSite({[u('/other')]: {body: page('Other', '<p>other page</p>')}});
    const snap = cachedSnapshot([cachedPage(AUDITED)]);
    const cache = fakeCache(snap);
    const result = await crawl(site, {auditedUrl: u('/other'), cache});
    expect(requested(site)).toEqual([u('/other')]);
    expect(result.state).toBe('cached');
    expect(result.snapshot.pages.map((/** @type {any} */ p) => p.url)).toEqual([
      u('/other'),
      AUDITED,
    ]);
    expect(result.snapshot.pages[0].title).toBe('Other');
    expect(result.snapshot.stats.requests).toBe(5);
    expect(cache.write).not.toHaveBeenCalled();
  });

  it('finds the audited page in a cached snapshot by its final URL too', async () => {
    const site = makeSite({});
    const redirected = {...cachedPage(u('/start')), finalUrl: AUDITED};
    const result = await crawl(site, {cache: fakeCache(cachedSnapshot([redirected]))});
    expect(result.state).toBe('cached');
    expect(site.requests).toEqual([]);
  });

  it('does not use the cache at all with a TTL of 0', async () => {
    const cache = fakeCache(cachedSnapshot([cachedPage(AUDITED)]));
    const site = makeSite({});
    const result = await crawl(site, {cache, env: {LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '0'}});
    expect(result.state).toBe('crawled');
    expect(cache.read).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
  });

  it('carries on when the cache throws', async () => {
    const cache = {
      read: jest.fn(() => {
        throw new Error('disk on fire');
      }),
      write: jest.fn(() => {
        throw new Error('disk on fire');
      }),
    };
    const result = await crawl(makeSite({}), {cache});
    expect(result.state).toBe('crawled');
  });
});

describe('crawlSite: when nothing works, and never throwing', () => {
  it('is unavailable, carrying the real error (so a private-address refusal keeps its hint)', async () => {
    const hint =
      'refusing to connect: a private/reserved IP address. To audit your own private host, set LHCI_SEO_ALLOW_PRIVATE_NETWORK=1.';
    const site = makeSite({[AUDITED]: new Error(hint), [u('/a')]: new Error(hint)});
    const result = await crawl(site, {pageLinks: [u('/a')]});
    expect(result.state).toBe('unavailable');
    expect(result.reason).toMatch(/LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/);
    expect(result.snapshot.pages.every((/** @type {any} */ p) => p.status === null)).toBe(true);
  });

  it('does not cache a crawl in which no page answered', async () => {
    const cache = fakeCache();
    await crawl(makeSite({[AUDITED]: new Error('down')}), {cache});
    expect(cache.write).not.toHaveBeenCalled();
  });

  it('survives dependencies that throw or return nonsense', async () => {
    const site = makeSite({});
    const results = await Promise.all([
      crawl(site, {fetchBytes: async () => null}),
      crawl(site, {
        fetchBytes: () => {
          throw new Error('sync throw');
        },
      }),
      crawl(site, {
        collectSitemap: () => {
          throw new Error('sync throw');
        },
      }),
      crawl(site, {pageLinks: null}),
      crawl(site, {pageLinks: [null, 5, {}, undefined]}),
    ]);
    for (const r of results) expect(['crawled', 'unavailable']).toContain(r.state);
  });

  it('never rejects, whatever is wrong', async () => {
    await expect(crawlSite(/** @type {any} */ ({}))).resolves.toMatchObject({state: 'unavailable'});
    await expect(crawlSite(/** @type {any} */ (undefined))).resolves.toMatchObject({
      state: 'unavailable',
    });
  });
});
