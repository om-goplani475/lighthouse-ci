/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: SitemapValid} = require('../../src/audits/sitemap-valid.js');
const {emptyDocument, SITEMAP_NAMESPACE} = require('../../src/lib/sitemap-parse.js');

const URL_A = 'https://example.com/sitemap.xml';

/**
 * A clean, valid urlset document, overridden per test.
 * @param {Partial<import('../../src/lib/sitemap-parse.js').SitemapDocument>} [overrides]
 */
const doc = (overrides = {}) => ({
  ...emptyDocument({url: URL_A, source: 'declared', parentUrl: null}),
  status: 200,
  kind: 'urlset',
  namespaceOk: true,
  locs: ['https://example.com/a'],
  entryCount: 1,
  ...overrides,
});

const run = (documents, extra = {}) =>
  SitemapValid.audit({
    SitemapDocuments: {
      discovery: 'robots-txt',
      ignoredSitemapLines: [],
      documentsTruncated: false,
      documents,
      ...extra,
    },
  });

describe('sitemap-valid audit', () => {
  it('passes a valid sitemap with no details', () => {
    expect(run([doc()])).toEqual({score: 1});
  });

  it('passes a valid index with valid children', () => {
    expect(
      run([
        doc({kind: 'sitemapindex'}),
        doc({source: 'index-child', url: 'https://example.com/s1.xml'}),
      ]).score
    ).toBe(1);
  });

  it.each([['none'], ['unavailable']])('is notApplicable when discovery is %s', discovery => {
    expect(run([], {discovery})).toEqual({score: null, notApplicable: true});
  });

  it('fails a sitemap that returns an HTTP error', () => {
    const result = run([doc({outcome: 'http-error', status: 404, kind: null})]);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      {url: URL_A, problem: 'Sitemap could not be fetched', detail: 'HTTP 404'},
    ]);
  });

  it('fails a redirecting sitemap and tells the reader to declare the final URL', () => {
    const result = run([
      doc({
        outcome: 'redirect',
        status: 301,
        redirectLocation: 'https://example.com/new.xml',
        kind: null,
      }),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].detail).toContain('https://example.com/new.xml');
    expect(result.details.items[0].detail).toContain('Declare the final URL');
  });

  it('fails a decompression error, and only notes a network error (a timeout says nothing about the sitemap)', () => {
    const result = run([
      doc({outcome: 'network-error', errorMessage: 'timed out after 10000ms', kind: null}),
      doc({
        outcome: 'decompression-error',
        errorMessage: 'could not decompress gzip data: bad',
        kind: null,
      }),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items.map(i => i.detail)).toEqual([
      'could not decompress gzip data: bad',
      'timed out after 10000ms',
    ]);
    expect(result.details.items[1].problem).toMatch(/not judged/);
    const onlyTimeout = run([
      doc({outcome: 'network-error', errorMessage: 'timed out after 10000ms', kind: null}),
    ]);
    expect(onlyTimeout.score).toBe(1);
    expect(onlyTimeout.displayValue).toMatch(/could not be fetched/);
  });

  it('fails malformed XML with the line and column', () => {
    const result = run([
      doc({kind: 'urlset', parseError: {message: 'unexpected close tag.', line: 4, column: 9}}),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items[0]).toMatchObject({
      problem: 'XML is not well-formed',
      detail: 'unexpected close tag. (line 4, column 9)',
    });
  });

  it('reports only the parse error for an empty/non-XML document (no second "wrong root" row)', () => {
    const result = run([
      doc({kind: 'invalid', parseError: {message: 'no root', line: 1, column: 1}}),
    ]);
    expect(result.details.items).toHaveLength(1);
    expect(result.details.items[0].problem).toBe('XML is not well-formed');
  });

  it('fails a well-formed document whose root is not a sitemap', () => {
    const result = run([doc({kind: 'invalid'})]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].problem).toBe('Root element is not a sitemap');
  });

  it('fails a missing or wrong namespace, naming the expected one', () => {
    const result = run([doc({namespaceOk: false})]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].detail).toContain(SITEMAP_NAMESPACE);
  });

  it('fails invalid locs with the count and up to three examples', () => {
    const result = run([
      doc({
        invalidLocCount: 5,
        invalidLocs: [
          {value: '/a', reason: 'not an absolute http(s) URL'},
          {value: '', reason: 'empty'},
          {value: 'ftp://x', reason: 'not an absolute http(s) URL'},
          {value: '/d', reason: 'not an absolute http(s) URL'},
        ],
      }),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].problem).toBe('5 invalid <loc> value(s)');
    expect(result.details.items[0].detail.split('; ')).toHaveLength(3);
  });

  it('does not fail a document that was never parsed because it exceeded the size cap', () => {
    expect(run([doc({kind: null, exceededUncompressedLimit: true})]).score).toBe(1);
  });

  it('gives each failing document its own rows, one bad among good', () => {
    const good = doc({url: 'https://example.com/good.xml'});
    const bad = doc({
      url: 'https://example.com/bad.xml',
      outcome: 'http-error',
      status: 404,
      kind: null,
    });
    const result = run([good, bad]);
    expect(result.score).toBe(0);
    expect(result.explanation).toBe('1 sitemap problem(s) found.');
    expect(result.details.items.map(i => i.url)).toEqual(['https://example.com/bad.xml']);
  });

  it('does not judge bot protection or a server error on a sitemap', () => {
    for (const status of [403, 429, 503]) {
      const result = run([doc({outcome: 'http-error', status, kind: null})]);
      expect(result.score).toBe(1);
    }
  });

  it('shows ignored robots.txt Sitemap lines without failing an otherwise valid sitemap', () => {
    const result = run([doc()], {ignoredSitemapLines: ['/relative.xml']});
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([
      expect.objectContaining({url: '/relative.xml', problem: expect.stringContaining('ignored')}),
    ]);
  });
});
