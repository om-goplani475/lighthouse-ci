/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: SitemapLimits} = require('../../src/audits/sitemap-limits.js');
const {emptyDocument, LIMITS} = require('../../src/lib/sitemap-parse.js');

/**
 * @param {Partial<import('../../src/lib/sitemap-parse.js').SitemapDocument>} [overrides]
 */
const doc = (overrides = {}) => ({
  ...emptyDocument({url: 'https://example.com/sitemap.xml', source: 'declared', parentUrl: null}),
  status: 200,
  kind: 'urlset',
  namespaceOk: true,
  entryCount: 100,
  compressedBytes: 5000,
  uncompressedBytes: 5000,
  ...overrides,
});

const run = (documents, extra = {}) =>
  SitemapLimits.audit({
    SitemapDocuments: {
      discovery: 'robots-txt',
      ignoredSitemapLines: [],
      documentsTruncated: false,
      documents,
      ...extra,
    },
  });

describe('sitemap-limits audit', () => {
  it('passes a small sitemap and always returns the per-document table', () => {
    const result = run([doc()]);
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([
      {
        url: 'https://example.com/sitemap.xml',
        type: 'Sitemap',
        entries: '100',
        size: '4.9 KiB',
        gzip: 'No',
        limit: 'Within limits',
      },
    ]);
  });

  it('passes at exactly 50,000 entries and fails at 50,001', () => {
    expect(run([doc({entryCount: 50_000})]).score).toBe(1);
    const over = run([doc({entryCount: 50_001, entriesTruncated: true})]);
    expect(over.score).toBe(0);
    expect(over.explanation).toBe('1 sitemap file(s) exceed a limit.');
    expect(over.details.items[0]).toMatchObject({
      entries: 'over 50,000',
      limit: 'Exceeded: over 50,000 entries',
    });
  });

  it('fails a sitemap index with more than 50,000 child sitemaps', () => {
    const result = run([doc({kind: 'sitemapindex', entryCount: 50_001, entriesTruncated: true})]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].type).toBe('Sitemap index');
  });

  it('fails a sitemap over 50 MiB uncompressed even though it was never parsed', () => {
    const result = run([
      doc({
        kind: null,
        gzip: true,
        exceededUncompressedLimit: true,
        compressedBytes: 900_000,
        uncompressedBytes: LIMITS.MAX_UNCOMPRESSED_BYTES,
      }),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items[0]).toMatchObject({
      type: 'Not parsed',
      entries: 'not counted',
      size: 'over 50 MiB uncompressed',
      gzip: 'Yes',
      limit: 'Exceeded: over 50 MiB',
    });
  });

  it('reports both limits when both are exceeded', () => {
    const result = run([
      doc({entryCount: 50_001, entriesTruncated: true, exceededUncompressedLimit: true}),
    ]);
    expect(result.details.items[0].limit).toBe('Exceeded: over 50,000 entries, over 50 MiB');
  });

  it('shows both compressed and uncompressed sizes for a gzip sitemap', () => {
    const result = run([
      doc({gzip: true, compressedBytes: 2048, uncompressedBytes: 3 * 1024 * 1024}),
    ]);
    expect(result.details.items[0].size).toBe('2.0 KiB gzip, 3.0 MiB uncompressed');
  });

  it('counts only the files that exceed a limit, and passes the rest', () => {
    const result = run([
      doc({url: 'https://example.com/ok.xml'}),
      doc({url: 'https://example.com/big.xml', entryCount: 60_000, entriesTruncated: true}),
    ]);
    expect(result.score).toBe(0);
    expect(result.explanation).toBe('1 sitemap file(s) exceed a limit.');
  });

  it('says when only some sitemap files were checked, on pass and on fail', () => {
    const pass = run([doc()], {documentsTruncated: true});
    expect(pass.score).toBe(1);
    expect(pass.displayValue).toContain('Only the first 1 sitemap files were checked');

    const fail = run([doc({entryCount: 50_001, entriesTruncated: true})], {
      documentsTruncated: true,
    });
    expect(fail.explanation).toContain('Only the first 1 sitemap files were checked');
  });

  it.each([['none'], ['unavailable']])('is notApplicable when discovery is %s', discovery => {
    expect(run([], {discovery})).toEqual({score: null, notApplicable: true});
  });

  it('is notApplicable when nothing was fetched successfully', () => {
    expect(run([doc({outcome: 'http-error', status: 404, kind: null})]).notApplicable).toBe(true);
    expect(run([doc({outcome: 'network-error', kind: null})]).notApplicable).toBe(true);
  });

  it('ignores an unfetched document but still judges the fetched one', () => {
    const result = run([
      doc({outcome: 'http-error', status: 500, kind: null}),
      doc({entryCount: 50_001, entriesTruncated: true}),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items).toHaveLength(1);
  });
});
