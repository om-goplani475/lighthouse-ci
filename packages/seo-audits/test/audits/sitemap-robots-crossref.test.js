/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: SitemapRobotsCrossref} = require('../../src/audits/sitemap-robots-crossref.js');
const {emptyDocument} = require('../../src/lib/sitemap-parse.js');

const PAGE = 'https://example.com/products/shoe';

/**
 * @param {string[]} locs
 * @param {Partial<import('../../src/lib/sitemap-parse.js').SitemapDocument>} [overrides]
 */
const doc = (locs, overrides = {}) => ({
  ...emptyDocument({url: 'https://example.com/sitemap.xml', source: 'declared', parentUrl: null}),
  status: 200,
  kind: 'urlset',
  locs,
  entryCount: locs.length,
  ...overrides,
});

/**
 * @param {string | null} robotsContent null = robots.txt returned 404
 * @param {ReturnType<typeof doc>[]} documents
 */
const run = (robotsContent, documents, {discovery = 'robots-txt', robotsStatus} = {}) =>
  SitemapRobotsCrossref.audit({
    SitemapDocuments: {
      discovery,
      unavailableReason: null,
      ignoredSitemapLines: [],
      documentsTruncated: false,
      documents,
    },
    RobotsTxt:
      robotsContent === null
        ? {status: robotsStatus ?? 404, content: ''}
        : {status: robotsStatus ?? 200, content: robotsContent},
    URL: {finalDisplayedUrl: PAGE},
  });

const ALLOW_ALL = 'User-agent: *\nDisallow:';

describe('sitemap-robots-crossref audit', () => {
  it('passes when no listed URL is disallowed, and says how many were checked', () => {
    const result = run(ALLOW_ALL, [doc(['https://example.com/a', 'https://example.com/b'])]);
    expect(result.score).toBe(1);
    expect(result.displayValue).toContain('Checked 2 sitemap URL(s) against robots.txt.');
  });

  it('fails a listed URL that robots.txt disallows for every crawler, naming both search engines', () => {
    const result = run('User-agent: *\nDisallow: /private/', [
      doc(['https://example.com/ok', 'https://example.com/private/page']),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      {
        url: 'https://example.com/private/page',
        problem: 'Listed in the sitemap but disallowed by robots.txt for Googlebot and Bingbot',
      },
    ]);
    expect(result.explanation).toContain('1 of 2 sitemap URL(s) are disallowed');
  });

  it('names only the crawler that is actually blocked', () => {
    const result = run('User-agent: Bingbot\nDisallow: /b/', [doc(['https://example.com/b/x'])]);
    expect(result.details.items[0].problem).toContain('for Bingbot');
    expect(result.details.items[0].problem).not.toContain('Googlebot');
  });

  it('respects Allow overriding a broader Disallow (the more specific rule wins)', () => {
    const result = run('User-agent: *\nDisallow: /private/\nAllow: /private/public/', [
      doc(['https://example.com/private/public/page']),
    ]);
    expect(result.score).toBe(1);
  });

  it('does not treat AI-crawler-only blocks as a conflict (only Googlebot and Bingbot count)', () => {
    const result = run('User-agent: GPTBot\nDisallow: /', [doc(['https://example.com/a'])]);
    expect(result.score).toBe(1);
  });

  it('checks every listed URL, not a sample, but lists at most 20 rows and reports the true total', () => {
    const locs = Array.from({length: 500}, (_, i) => `https://example.com/private/${i}`);
    const result = run('User-agent: *\nDisallow: /private/', [doc(locs)]);
    expect(result.score).toBe(0);
    expect(result.details.items).toHaveLength(20);
    expect(result.explanation).toContain('500 of 500 sitemap URL(s)');
    expect(result.explanation).toContain('showing the first 20');
  });

  it('does not check URLs on another origin, since robots.txt does not govern them', () => {
    // These paths would all be disallowed if checked; each is on a different host, scheme or port.
    const result = run('User-agent: *\nDisallow: /a', [
      doc(['https://other.test/a', 'http://example.com/a', 'https://example.com:8443/a']),
    ]);
    expect(result).toEqual({score: null, notApplicable: true});
  });

  it('reports the skipped other-host count alongside checked URLs', () => {
    const result = run(ALLOW_ALL, [doc(['https://example.com/a', 'https://other.test/b'])]);
    expect(result.displayValue).toContain('1 on another host were not checked.');
  });

  it('flags a declared sitemap whose own path robots.txt disallows, with the hedged wording', () => {
    const result = run('User-agent: *\nDisallow: /sitemap.xml', [doc(['https://example.com/a'])]);
    expect(result.score).toBe(0);
    expect(result.details.items[0]).toEqual({
      url: 'https://example.com/sitemap.xml',
      problem: "The sitemap's own path is disallowed by robots.txt for Googlebot and Bingbot",
    });
    expect(SitemapRobotsCrossref.meta.description).toContain('differ on whether they apply');
  });

  it('does not check an index child sitemap path, only declared and default-location sitemaps', () => {
    const result = run('User-agent: *\nDisallow: /child.xml', [
      doc(['https://example.com/a'], {url: 'https://example.com/child.xml', source: 'index-child'}),
    ]);
    expect(result.score).toBe(1);
  });

  it('passes when robots.txt is absent (404): nothing is disallowed', () => {
    const result = run(null, [doc(['https://example.com/a'])]);
    expect(result.score).toBe(1);
  });

  it.each([[503], [null]])('is notApplicable when robots.txt is unavailable (%s)', status => {
    const result = SitemapRobotsCrossref.audit({
      SitemapDocuments: {discovery: 'robots-txt', documents: [doc(['https://example.com/a'])]},
      RobotsTxt: {status, content: null},
      URL: {finalDisplayedUrl: PAGE},
    });
    expect(result).toEqual({score: null, notApplicable: true});
  });

  it.each([['none'], ['unavailable']])('is notApplicable when discovery is %s', discovery => {
    expect(run(ALLOW_ALL, [], {discovery})).toEqual({score: null, notApplicable: true});
  });

  it('ignores an index, a failed fetch, and an unparsed document', () => {
    const result = run('User-agent: *\nDisallow: /', [
      doc(['https://example.com/child.xml'], {kind: 'sitemapindex', source: 'index-child'}),
      doc(['https://example.com/x'], {outcome: 'http-error', kind: null, source: 'index-child'}),
    ]);
    expect(result).toEqual({score: null, notApplicable: true});
  });

  describe('audited page listed in the sitemap (informational, never affects the score)', () => {
    it('says the page is listed, tolerating a trailing slash and a fragment', () => {
      const result = run(ALLOW_ALL, [doc(['https://example.com/products/shoe/#reviews'])]);
      expect(result.score).toBe(1);
      expect(result.displayValue).toContain('The audited page is listed in the sitemap.');
    });

    it('says the page is not listed without failing the audit', () => {
      const result = run(ALLOW_ALL, [doc(['https://example.com/other'])]);
      expect(result.score).toBe(1);
      expect(result.displayValue).toContain(
        'The audited page is not listed in the sitemap (informational only).'
      );
    });

    it('does not mention the page when there is no URL list to compare against', () => {
      const result = run('User-agent: *\nDisallow: /sitemap.xml', [
        doc([], {kind: 'sitemapindex'}),
      ]);
      expect(result.explanation).not.toContain('audited page');
    });
  });
});
