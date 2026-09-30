/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The audit is a pure function of the `urlSample` the gatherer collected, so these tests feed it
 * fixture artifacts. Sampling, bounds, retry and the time budget are tested where they live
 * (`test/lib/sitemap-url-sample.test.js`, `test/gatherers/sitemap-documents*.test.js`), and the exact
 * end-to-end output is pinned by `sitemap-url-status.characterization.test.js`.
 */

/* eslint-env jest */

const {default: SitemapUrlStatus} = require('../../src/audits/sitemap-url-status.js');

/** A sampled page as the gatherer records it. */
const page = (url, overrides = {}) => ({
  url,
  status: 200,
  redirectLocation: null,
  error: null,
  notChecked: false,
  contentType: 'text/html',
  xRobotsTag: [],
  bodyRead: 'html',
  truncated: false,
  metas: [],
  canonicals: [],
  headComplete: true,
  ...overrides,
});
const u = n => `https://example.com/p${n}`;

const run = (
  pages,
  {eligibleCount = pages.length, skippedCrossOrigin = 0, discovery = 'robots-txt'} = {}
) =>
  SitemapUrlStatus.audit({
    SitemapDocuments: {
      discovery,
      unavailableReason: null,
      ignoredSitemapLines: [],
      documentsTruncated: false,
      documents: [],
      urlSample: {sampleSize: 10, eligibleCount, skippedCrossOrigin, pages},
    },
  });

describe('sitemap-url-status audit', () => {
  it('passes when every sampled URL returned 2xx, and says it was a sample', () => {
    const result = run([page(u(0)), page(u(1)), page(u(2))]);
    expect(result.score).toBe(1);
    expect(result.displayValue).toBe('Checked 3 of 3 listed URLs (a sample).');
    expect(result.details.items).toEqual([
      {url: u(0), result: 'HTTP 200'},
      {url: u(1), result: 'HTTP 200'},
      {url: u(2), result: 'HTTP 200'},
    ]);
  });

  it('reports how many URLs the sample was drawn from', () => {
    const result = run([page(u(0)), page(u(1))], {eligibleCount: 1731});
    expect(result.displayValue).toBe('Checked 2 of 1731 listed URLs (a sample).');
  });

  it('fails a 404 with the status in the table', () => {
    const result = run([page(u(0)), page(u(1), {status: 404}), page(u(2))]);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('1 of 3 sampled URL(s) did not return 200');
    expect(result.details.items).toContainEqual({url: u(1), result: 'HTTP 404'});
  });

  it('fails a redirect (only 2xx passes) and shows where it goes', () => {
    const result = run([page(u(0), {status: 301, redirectLocation: 'https://example.com/new'})]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].result).toBe('HTTP 301, redirects to https://example.com/new');
  });

  it('fails a URL that could not be fetched, with the reason', () => {
    const result = run([page(u(0), {status: null, error: 'ECONNREFUSED'})]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].result).toBe('could not be fetched: ECONNREFUSED');
  });

  it.each([[200], [204], [206]])('accepts %i as passing', status => {
    expect(run([page(u(0), {status})]).score).toBe(1);
  });

  it.each([[500], [503], [403], [199], [300]])('fails %i', status => {
    expect(run([page(u(0), {status})]).score).toBe(0);
  });

  it('is judged on status alone: noindex or a canonical elsewhere does not fail it', () => {
    const result = run([
      page(u(0), {
        xRobotsTag: ['noindex'],
        metas: [{name: 'robots', content: 'noindex'}],
        canonicals: ['https://example.com/other'],
      }),
    ]);
    expect(result.score).toBe(1);
  });

  it('passes a non-HTML page whose status is 2xx, and a page whose body was not read', () => {
    const result = run([
      page(u(0), {contentType: 'application/pdf', bodyRead: 'skipped-not-html'}),
      page(u(1), {bodyRead: 'skipped-compressed', headComplete: false}),
    ]);
    expect(result.score).toBe(1);
  });

  it('says how many were not checked because the time budget ran out, and does not count them as failures', () => {
    const result = run(
      [
        page(u(0)),
        page(u(1), {status: null, notChecked: true}),
        page(u(2), {status: null, notChecked: true}),
      ],
      {
        eligibleCount: 3,
      }
    );
    expect(result.score).toBe(1);
    expect(result.displayValue).toBe(
      'Checked 1 of 3 listed URLs (a sample). 2 not checked: the time budget ran out.'
    );
    expect(result.details.items[1].result).toBe('not checked (time budget used up)');
  });

  it('says how many other-host URLs were not requested', () => {
    const result = run([page(u(0))], {skippedCrossOrigin: 3});
    expect(result.displayValue).toBe(
      'Checked 1 of 1 listed URLs (a sample). 3 listed on another host were not requested.'
    );
  });

  it('puts the failure count and the sample note in the explanation', () => {
    const result = run([page(u(0), {status: 404}), page(u(1))], {
      eligibleCount: 40,
      skippedCrossOrigin: 2,
    });
    expect(result.explanation).toBe(
      '1 of 2 sampled URL(s) did not return 200. Checked 2 of 40 listed URLs (a sample). 2 listed on another host were not requested.'
    );
  });

  it.each([['none'], ['unavailable']])('is notApplicable when discovery is %s', discovery => {
    expect(run([page(u(0))], {discovery})).toEqual({score: null, notApplicable: true});
  });

  it('is notApplicable when there is no sample: null, empty, or an artifact from before the sample existed', () => {
    const artifact = urlSample => ({
      SitemapDocuments: {
        discovery: 'robots-txt',
        unavailableReason: null,
        ignoredSitemapLines: [],
        documentsTruncated: false,
        documents: [],
        ...(urlSample === undefined ? {} : {urlSample}),
      },
    });
    expect(SitemapUrlStatus.audit(artifact(null))).toEqual({score: null, notApplicable: true});
    expect(SitemapUrlStatus.audit(artifact(undefined))).toEqual({score: null, notApplicable: true});
    expect(
      SitemapUrlStatus.audit(
        artifact({sampleSize: 10, eligibleCount: 0, skippedCrossOrigin: 0, pages: []})
      )
    ).toEqual({score: null, notApplicable: true});
  });

  it('makes no request of its own: it does not import the fetch layer', () => {
    const source = require('fs').readFileSync(
      require.resolve('../../src/audits/sitemap-url-status.js'),
      'utf8'
    );
    expect(source).not.toMatch(/safe-fetch/);
    expect(source).not.toMatch(/safeFetch/);
  });
});
