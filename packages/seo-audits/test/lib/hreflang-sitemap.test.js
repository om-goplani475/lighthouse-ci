/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildSitemapProduct} = require('../../src/lib/hreflang-sitemap.js');

const EN = 'https://example.com/en/';
const alt = (/** @type {string} */ hreflang, /** @type {string} */ href) => ({hreflang, href});
const page = [alt('en', EN), alt('fr', 'https://example.com/fr/')];
const data = (/** @type {any} */ alternates = page) => ({
  pageUrl: EN,
  canonical: EN,
  htmlLang: 'en',
  contentLanguage: null,
  ogLocale: null,
  alternates,
  checks: {state: 'none', reason: null, results: [], notChecked: 0},
});
const sitemaps = (/** @type {any} */ targetEntry) => ({
  documents: [
    {url: 'https://example.com/s.xml', targetEntry: null},
    {url: 'https://example.com/c.xml', targetEntry},
  ],
});

describe('buildSitemapProduct (informational)', () => {
  it('reports agreement, ignoring case of the code and a trailing slash', () => {
    const p = buildSitemapProduct(
      data(),
      sitemaps({
        alternates: [alt('EN', 'https://example.com/en'), alt('fr', 'https://example.com/fr/')],
        alternatesTruncated: false,
      })
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('The sitemap and the page list the same 2 alternates');
  });

  it('lists differences in both directions and never fails', () => {
    const p = buildSitemapProduct(
      data(),
      sitemaps({
        alternates: [alt('en', EN), alt('de', 'https://example.com/de/')],
        alternatesTruncated: true,
      })
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe(
      '2 differences between the page and the sitemap (the sitemap list was cut at 100 entries)'
    );
    expect(p.details.items.map((/** @type {any} */ i) => [i.hreflang, i.result])).toEqual([
      ['fr', 'in the page, not in the sitemap'],
      ['de', 'in the sitemap, not in the page'],
    ]);
  });

  it('notes a page with no alternates in the sitemap', () => {
    const p = buildSitemapProduct(data(), sitemaps({alternates: [], alternatesTruncated: false}));
    expect(p.details.items).toHaveLength(2);
  });

  it('says so when the page is not listed, and is not applicable without a sitemap or hreflang', () => {
    expect(buildSitemapProduct(data(), sitemaps(null)).displayValue).toBe(
      'This page is not listed in the sitemap'
    );
    expect(buildSitemapProduct(data(), {documents: []}).notApplicable).toBe(true);
    expect(buildSitemapProduct(data(), null).notApplicable).toBe(true);
    expect(buildSitemapProduct(data([]), sitemaps(null)).notApplicable).toBe(true);
    expect(buildSitemapProduct(null, sitemaps(null)).notApplicable).toBe(true);
  });
});
