/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  normalizeUrl,
  sameOrigin,
  selectSeeds,
  cacheKey,
  isSnapshot,
  SNAPSHOT_VERSION,
  USER_AGENT,
} = require('../../src/lib/crawl-snapshot.js');

describe('normalizeUrl', () => {
  it('lower-cases scheme and host, drops default ports, resolves dot segments, drops the fragment', () => {
    expect(normalizeUrl('HTTPS://Example.COM:443/a/./b/../c#frag')).toBe('https://example.com/a/c');
    expect(normalizeUrl('http://example.com:80/')).toBe('http://example.com/');
  });

  it('keeps a non-default port and the query exactly as written', () => {
    expect(normalizeUrl('https://example.com:8443/p?b=2&a=1')).toBe(
      'https://example.com:8443/p?b=2&a=1'
    );
    expect(normalizeUrl('https://example.com/p?')).toBe('https://example.com/p?');
  });

  it('resolves relative and protocol-relative references against a base', () => {
    expect(normalizeUrl('/x?y=1', 'https://example.com/a/b')).toBe('https://example.com/x?y=1');
    expect(normalizeUrl('c', 'https://example.com/a/b')).toBe('https://example.com/a/c');
    expect(normalizeUrl('//cdn.example.com/z', 'https://example.com/')).toBe(
      'https://cdn.example.com/z'
    );
  });

  it('returns null for non-http(s) schemes and unparseable input', () => {
    for (const href of [
      'mailto:a@b.c',
      'javascript:alert(1)',
      'ftp://example.com/',
      'file:///etc/passwd',
      'data:text/html,x',
      'http://[bad',
    ]) {
      expect(normalizeUrl(href, 'https://example.com/')).toBeNull();
    }
    expect(normalizeUrl('relative/only')).toBeNull();
    // An empty href refers to the page itself, so it is the base URL, not an error.
    expect(normalizeUrl('', 'https://example.com/a?x=1#f')).toBe('https://example.com/a?x=1');
  });

  it('refuses a URL that carries credentials', () => {
    expect(normalizeUrl('https://user:pass@example.com/')).toBeNull();
    expect(normalizeUrl('https://user@example.com/')).toBeNull();
  });

  it('handles IPv6 literals', () => {
    expect(normalizeUrl('http://[::1]:8080/x#y')).toBe('http://[::1]:8080/x');
  });
});

describe('sameOrigin', () => {
  it('compares scheme, host and port', () => {
    expect(sameOrigin('https://example.com/a', 'https://example.com/b?x=1')).toBe(true);
    expect(sameOrigin('https://example.com/', 'http://example.com/')).toBe(false);
    expect(sameOrigin('https://example.com/', 'https://www.example.com/')).toBe(false);
    expect(sameOrigin('https://example.com/', 'https://example.com:8443/')).toBe(false);
    expect(sameOrigin('https://example.com/', 'https://example.com.evil.test/')).toBe(false);
    expect(sameOrigin('https://example.com/', 'https://EXAMPLE.com:443/x')).toBe(true);
  });

  it('is false for anything unparseable', () => {
    expect(sameOrigin('not a url', 'https://example.com/')).toBe(false);
    expect(sameOrigin('https://example.com/', '')).toBe(false);
  });
});

const A = 'https://example.com/';
const u = (/** @type {string} */ p) => `https://example.com/${p}`;
const range = (/** @type {string} */ prefix, /** @type {number} */ n) =>
  Array.from({length: n}, (_, i) => u(`${prefix}${i}`));

describe('selectSeeds', () => {
  const H = 'https://example.com/home';
  const count = (/** @type {any[]} */ seeds, /** @type {string} */ source) =>
    seeds.filter(s => s.source === source).length;

  it('always starts with the audited page, then the homepage', () => {
    const seeds = selectSeeds({
      audited: A,
      home: H,
      links: [u('a')],
      sitemapUrls: [u('b')],
      pages: 10,
    });
    expect(seeds[0]).toEqual({url: A, source: 'audited'});
    expect(seeds[1]).toEqual({url: H, source: 'home'});
  });

  it('adds no homepage seed when it is the audited page, absent, or the cap leaves no room', () => {
    expect(selectSeeds({audited: A, home: A, links: [], sitemapUrls: [], pages: 10})).toEqual([
      {url: A, source: 'audited'},
    ]);
    expect(selectSeeds({audited: A, links: [], sitemapUrls: [], pages: 10})).toHaveLength(1);
    expect(selectSeeds({audited: A, home: H, links: [u('a')], sitemapUrls: [], pages: 1})).toEqual([
      {url: A, source: 'audited'},
    ]);
    expect(selectSeeds({audited: A, home: H, links: [u('a')], sitemapUrls: [], pages: 2})).toEqual([
      {url: A, source: 'audited'},
      {url: H, source: 'home'},
    ]);
  });

  it('returns only the audited page when the cap is 1 or invalid', () => {
    for (const pages of [1, 0, -5, NaN]) {
      expect(
        selectSeeds({audited: A, home: H, links: [u('a')], sitemapUrls: [u('b')], pages})
      ).toHaveLength(1);
    }
  });

  it('leaves at least half of the remaining slots for link-following', () => {
    const seeds = selectSeeds({
      audited: A,
      home: H,
      links: range('l', 100),
      sitemapUrls: range('s', 100),
      pages: 50,
    });
    // 48 slots after the audited page and the homepage: 24 for seeds (12 links, 12 sitemap), 24 left.
    expect(seeds).toHaveLength(26);
    expect(count(seeds, 'link')).toBe(12);
    expect(count(seeds, 'sitemap')).toBe(12);
  });

  it('splits the seed share between links and the sitemap, links getting the extra one when odd', () => {
    const odd = selectSeeds({
      audited: A,
      links: range('l', 50),
      sitemapUrls: range('s', 50),
      pages: 10,
    });
    // 9 slots, share 5: 3 links, 2 sitemap.
    expect(count(odd, 'link')).toBe(3);
    expect(count(odd, 'sitemap')).toBe(2);
  });

  it('never exceeds the page cap', () => {
    for (const pages of [2, 3, 7, 50, 200]) {
      const seeds = selectSeeds({
        audited: A,
        home: H,
        links: range('l', 300),
        sitemapUrls: range('s', 300),
        pages,
      });
      expect(seeds.length).toBeLessThanOrEqual(pages);
      expect(seeds.length).toBeLessThanOrEqual(2 + Math.ceil((pages - 2) / 2));
    }
  });

  it('gives spare seed slots to the other list when one is short, but never past the share', () => {
    const fewLinks = selectSeeds({
      audited: A,
      links: range('l', 1),
      sitemapUrls: range('s', 50),
      pages: 10,
    });
    expect(count(fewLinks, 'link')).toBe(1);
    expect(count(fewLinks, 'sitemap')).toBe(4);
    const fewSitemap = selectSeeds({
      audited: A,
      links: range('l', 50),
      sitemapUrls: range('s', 1),
      pages: 10,
    });
    expect(count(fewSitemap, 'sitemap')).toBe(1);
    expect(count(fewSitemap, 'link')).toBe(4);
    const neither = selectSeeds({audited: A, links: [], sitemapUrls: [], pages: 10});
    expect(neither).toEqual([{url: A, source: 'audited'}]);
  });

  it('deduplicates, drops the audited page and the homepage from the lists, and counts a URL in both as a link', () => {
    const seeds = selectSeeds({
      audited: A,
      home: H,
      links: [A, H, u('a'), u('a'), u('b')],
      sitemapUrls: [A, H, u('b'), u('c'), u('c')],
      pages: 20,
    });
    expect(seeds.map(s => s.url)).toEqual([A, H, u('a'), u('b'), u('c')]);
    expect(seeds.find(s => s.url === u('b'))?.source).toBe('link');
    expect(seeds.find(s => s.url === u('c'))?.source).toBe('sitemap');
  });

  it('is deterministic, and keeps the first and last of a long list', () => {
    const input = {audited: A, links: range('l', 100), sitemapUrls: range('s', 100), pages: 20};
    expect(selectSeeds(input)).toEqual(selectSeeds(input));
    const links = selectSeeds(input)
      .filter(s => s.source === 'link')
      .map(s => s.url);
    expect(links[0]).toBe(u('l0'));
    expect(links[links.length - 1]).toBe(u('l99'));
  });
});

describe('cacheKey', () => {
  const base = {
    origin: 'https://example.com',
    pages: 50,
    depth: 3,
    robots: /** @type {'honour'} */ ('honour'),
    userAgent: USER_AGENT,
  };

  it('is a stable lower-case hex sha-256', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey(base)).toBe(cacheKey({...base}));
  });

  it('differs for every input', () => {
    const keys = new Set([
      cacheKey(base),
      cacheKey({...base, origin: 'https://example.org'}),
      cacheKey({...base, pages: 49}),
      cacheKey({...base, depth: 2}),
      cacheKey({...base, robots: 'ignore'}),
      cacheKey({...base, userAgent: 'other/1'}),
    ]);
    expect(keys.size).toBe(6);
  });

  it('cannot be steered by a hostile origin into a path (it is always hex)', () => {
    expect(cacheKey({...base, origin: '../../etc/passwd'})).toMatch(/^[0-9a-f]{64}$/);
  });
});

const page = (/** @type {any} */ over = {}) => ({
  url: A,
  finalUrl: A,
  redirects: [],
  status: 200,
  contentType: 'text/html',
  bytes: 10,
  truncated: false,
  title: 'T',
  description: null,
  canonicals: [],
  robotsMetas: [],
  xRobotsTag: [],
  h1: [],
  textHash: 'abc',
  textLength: 3,
  wordCount: 1,
  links: [],
  externalLinks: [],
  pagination: {next: [], prev: []},
  depth: 0,
  source: 'audited',
  extraction: 'ok',
  ...over,
});
const snapshot = (/** @type {any} */ over = {}) => ({
  version: SNAPSHOT_VERSION,
  origin: 'https://example.com',
  createdAt: '2026-10-01T00:00:00.000Z',
  bounds: {pages: 50, depth: 3, budgetMs: 120000, robots: 'honour', userAgent: USER_AGENT},
  robots: {state: 'present'},
  seeds: {audited: 1, home: 0, links: 0, sitemap: 0},
  sitemapUrls: [],
  pages: [page()],
  skipped: [],
  stats: {
    requests: 1,
    elapsedMs: 5,
    truncatedByBudget: false,
    overPageCap: false,
    cutByDepth: false,
  },
  ...over,
});

describe('isSnapshot', () => {
  it('accepts a valid snapshot, with no pages too', () => {
    expect(isSnapshot(snapshot())).toBe(true);
    expect(isSnapshot(snapshot({pages: []}))).toBe(true);
    expect(isSnapshot(snapshot({pages: [page({status: null, textHash: null})]}))).toBe(true);
  });

  it('rejects anything that is not an object', () => {
    for (const v of [null, undefined, 5, 'x', [], [snapshot()], true]) {
      expect(isSnapshot(v)).toBe(false);
    }
  });

  it('rejects a wrong or missing version', () => {
    // A version 1 cache file (before Phase 8) is not read as version 2: the site is crawled again.
    expect(isSnapshot(snapshot({version: 1}))).toBe(false);
    expect(isSnapshot(snapshot({version: 3}))).toBe(false);
    expect(isSnapshot(snapshot({version: undefined}))).toBe(false);
  });

  it('rejects missing or mistyped fields', () => {
    for (const over of [
      {origin: 5},
      {createdAt: 'not a date'},
      {createdAt: 5},
      {bounds: null},
      {bounds: {pages: 50, depth: 3, budgetMs: 1, robots: 'maybe', userAgent: 'x'}},
      {bounds: {pages: '50', depth: 3, budgetMs: 1, robots: 'honour', userAgent: 'x'}},
      {bounds: {pages: 50, budgetMs: 1, robots: 'honour', userAgent: 'x'}},
      {robots: {state: 'weird'}},
      {robots: null},
      {seeds: {audited: 1}},
      {seeds: {audited: 1, links: 0, sitemap: 0}},
      {sitemapUrls: 'x'},
      {stats: {requests: 1, elapsedMs: 5, truncatedByBudget: false}},
      {pages: 'x'},
      {skipped: null},
      {stats: {requests: 1}},
    ]) {
      expect(isSnapshot(snapshot(over))).toBe(false);
    }
  });

  it('rejects a snapshot with a malformed page', () => {
    for (const over of [
      {url: 5},
      {links: 'x'},
      {truncated: 'no'},
      {extraction: 'weird'},
      {status: '200'},
      {textHash: 5},
      {depth: '0'},
      {externalLinks: null},
      {pagination: null},
      {pagination: {next: []}},
    ]) {
      expect(isSnapshot(snapshot({pages: [page(over)]}))).toBe(false);
    }
    expect(isSnapshot(snapshot({pages: [page(), null]}))).toBe(false);
  });
});
