/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: SitemapDuplicateUrls} = require('../../src/audits/sitemap-duplicate-urls.js');
const {emptyDocument} = require('../../src/lib/sitemap-parse.js');

/**
 * @param {string[]} locs
 * @param {Partial<import('../../src/lib/sitemap-parse.js').SitemapDocument>} [overrides]
 */
const doc = (locs, overrides = {}) => ({
  ...emptyDocument({url: 'https://example.com/sitemap.xml', source: 'declared', parentUrl: null}),
  status: 200,
  kind: 'urlset',
  namespaceOk: true,
  locs,
  entryCount: locs.length,
  ...overrides,
});

const run = (documents, discovery = 'robots-txt') =>
  SitemapDuplicateUrls.audit({
    SitemapDocuments: {discovery, ignoredSitemapLines: [], documentsTruncated: false, documents},
  });

describe('sitemap-duplicate-urls audit', () => {
  it('passes when every URL is distinct', () => {
    expect(run([doc(['https://example.com/a', 'https://example.com/b'])])).toEqual({score: 1});
  });

  it('fails when a URL is listed twice, reporting the sitemap, URL and count', () => {
    const result = run([
      doc([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/a',
        'https://example.com/a',
      ]),
    ]);
    expect(result.score).toBe(0);
    expect(result.explanation).toBe('1 URL(s) are listed more than once.');
    expect(result.details.items).toEqual([
      {sitemap: 'https://example.com/sitemap.xml', url: 'https://example.com/a', count: 3},
    ]);
  });

  it('compares exact strings: trailing slash and letter case are not duplicates', () => {
    const result = run([
      doc([
        'https://example.com/a',
        'https://example.com/a/',
        'https://example.com/A',
        'https://EXAMPLE.com/a',
      ]),
    ]);
    expect(result.score).toBe(1);
  });

  it('checks each sitemap on its own: the same URL in two files is not a duplicate', () => {
    const result = run([
      doc(['https://example.com/a'], {url: 'https://example.com/s1.xml'}),
      doc(['https://example.com/a'], {url: 'https://example.com/s2.xml'}),
    ]);
    expect(result.score).toBe(1);
  });

  it('attributes duplicates to the right sitemap file', () => {
    const result = run([
      doc(['https://example.com/a'], {url: 'https://example.com/s1.xml'}),
      doc(['https://example.com/b', 'https://example.com/b'], {url: 'https://example.com/s2.xml'}),
    ]);
    expect(result.details.items).toEqual([
      {sitemap: 'https://example.com/s2.xml', url: 'https://example.com/b', count: 2},
    ]);
  });

  it('caps the table at 20 rows but reports the true total', () => {
    const locs = Array.from({length: 25}, (_, i) => `https://example.com/${i}`);
    const result = run([doc([...locs, ...locs])]);
    expect(result.details.items).toHaveLength(20);
    expect(result.explanation).toContain('25 URL(s)');
    expect(result.explanation).toContain('showing the first 20');
  });

  it.each([['none'], ['unavailable']])('is notApplicable when discovery is %s', discovery => {
    expect(run([], discovery)).toEqual({score: null, notApplicable: true});
  });

  it('is notApplicable when no document is a fetched urlset (index only, or every fetch failed)', () => {
    expect(run([doc(['https://example.com/s1.xml'], {kind: 'sitemapindex'})]).notApplicable).toBe(
      true
    );
    expect(run([doc([], {outcome: 'http-error', status: 500, kind: null})]).notApplicable).toBe(
      true
    );
    expect(
      run([doc([], {kind: 'invalid', parseError: {message: 'x', line: 1, column: 1}})])
        .notApplicable
    ).toBe(true);
  });

  it('skips a failed document but still checks the good one', () => {
    const result = run([
      doc([], {outcome: 'network-error', kind: null}),
      doc(['https://example.com/a', 'https://example.com/a']),
    ]);
    expect(result.score).toBe(0);
  });

  it('notes that a truncated document was only partly checked, on pass and on fail', () => {
    const truncated = {entriesTruncated: true};
    const pass = run([doc(['https://example.com/a'], truncated)]);
    expect(pass.score).toBe(1);
    expect(pass.displayValue).toContain('only the first 1 URLs');

    const fail = run([doc(['https://example.com/a', 'https://example.com/a'], truncated)]);
    expect(fail.score).toBe(0);
    expect(fail.explanation).toContain('only the first 2 URLs');
  });
});
