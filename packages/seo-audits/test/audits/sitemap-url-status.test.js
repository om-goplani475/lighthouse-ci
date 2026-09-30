/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

jest.mock('../../src/lib/safe-fetch.js', () => ({
  safeFetchStatus: jest.fn(),
}));

const {safeFetchStatus} = require('../../src/lib/safe-fetch.js');
const {default: SitemapUrlStatus} = require('../../src/audits/sitemap-url-status.js');
const {emptyDocument} = require('../../src/lib/sitemap-parse.js');
const {SAMPLE_SIZE_ENV} = require('../../src/lib/sitemap-url-sample.js');

const doc = (locs, overrides = {}) => ({
  ...emptyDocument({url: 'https://example.com/sitemap.xml', source: 'declared', parentUrl: null}),
  status: 200,
  kind: 'urlset',
  locs,
  entryCount: locs.length,
  ...overrides,
});

const run = (documents, discovery = 'robots-txt') =>
  SitemapUrlStatus.audit({
    SitemapDocuments: {
      discovery,
      unavailableReason: null,
      ignoredSitemapLines: [],
      documentsTruncated: false,
      documents,
    },
  });

const pages = n => Array.from({length: n}, (_, i) => `https://example.com/p${i}`);

describe('sitemap-url-status audit', () => {
  const original = process.env[SAMPLE_SIZE_ENV];
  beforeEach(() => {
    safeFetchStatus.mockReset();
    delete process.env[SAMPLE_SIZE_ENV];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[SAMPLE_SIZE_ENV];
    else process.env[SAMPLE_SIZE_ENV] = original;
  });

  it('passes when every sampled URL returns 200, and says it was a sample', async () => {
    safeFetchStatus.mockResolvedValue({status: 200});
    const result = await run([doc(pages(3))]);
    expect(result.score).toBe(1);
    expect(result.displayValue).toBe('Checked 3 of 3 listed URLs (a sample).');
    expect(result.details.items).toHaveLength(3);
  });

  it('checks 10 URLs by default out of a large sitemap, evenly spread, first and last included', async () => {
    safeFetchStatus.mockResolvedValue({status: 200});
    const result = await run([doc(pages(1000))]);
    expect(safeFetchStatus).toHaveBeenCalledTimes(10);
    const requested = safeFetchStatus.mock.calls.map(c => c[0]);
    expect(requested).toContain('https://example.com/p0');
    expect(requested).toContain('https://example.com/p999');
    expect(result.displayValue).toBe('Checked 10 of 1000 listed URLs (a sample).');
  });

  it('honors the sample-size variable, capped at 25', async () => {
    safeFetchStatus.mockResolvedValue({status: 200});
    process.env[SAMPLE_SIZE_ENV] = '4';
    await run([doc(pages(100))]);
    expect(safeFetchStatus).toHaveBeenCalledTimes(4);
    safeFetchStatus.mockClear();
    process.env[SAMPLE_SIZE_ENV] = '500';
    await run([doc(pages(100))]);
    expect(safeFetchStatus).toHaveBeenCalledTimes(25);
  });

  it('fails a 404 with the status in the table', async () => {
    safeFetchStatus.mockImplementation(async url => ({status: url.endsWith('p1') ? 404 : 200}));
    const result = await run([doc(pages(3))]);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('1 of 3 sampled URL(s) did not return 200');
    expect(result.details.items).toContainEqual({
      url: 'https://example.com/p1',
      result: 'HTTP 404',
    });
  });

  it('fails a redirect (only 2xx passes) and shows where it goes', async () => {
    safeFetchStatus.mockResolvedValue({status: 301, redirectLocation: 'https://example.com/new'});
    const result = await run([doc(['https://example.com/old'])]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].result).toBe('HTTP 301, redirects to https://example.com/new');
  });

  it('fails a URL that cannot be fetched, with the reason', async () => {
    safeFetchStatus.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await run([doc(['https://example.com/a'])]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].result).toBe('could not be fetched: ECONNREFUSED');
  });

  it('accepts any 2xx as passing', async () => {
    safeFetchStatus.mockResolvedValue({status: 204});
    expect((await run([doc(['https://example.com/a'])])).score).toBe(1);
  });

  it('never requests a URL on another host and says how many it skipped', async () => {
    safeFetchStatus.mockResolvedValue({status: 200});
    const result = await run([
      doc(['https://example.com/a', 'https://other.test/b', 'http://169.254.169.254/']),
    ]);
    expect(safeFetchStatus.mock.calls.map(c => c[0])).toEqual(['https://example.com/a']);
    expect(result.displayValue).toContain('2 listed on another host were not requested');
  });

  it.each([['none'], ['unavailable']])('is notApplicable when discovery is %s', async discovery => {
    expect(await run([], discovery)).toEqual({score: null, notApplicable: true});
    expect(safeFetchStatus).not.toHaveBeenCalled();
  });

  it('is notApplicable, and requests nothing, when there is no URL list to sample', async () => {
    expect(await run([doc(['https://example.com/c.xml'], {kind: 'sitemapindex'})])).toEqual({
      score: null,
      notApplicable: true,
    });
    expect(await run([doc(['https://other.test/a'])])).toEqual({score: null, notApplicable: true});
    expect(safeFetchStatus).not.toHaveBeenCalled();
  });
});
