/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const CrawlCoverage = require('../../src/audits/crawl-coverage.js').default;

describe('crawl-coverage audit', () => {
  it('declares its id, that it is informative, and the artifact it reads', () => {
    expect(CrawlCoverage.meta.id).toBe('crawl-coverage');
    expect(CrawlCoverage.meta.scoreDisplayMode).toBe('informative');
    expect(CrawlCoverage.meta.requiredArtifacts).toEqual(['SiteCrawl']);
    expect(CrawlCoverage.meta.id).not.toMatch(/-\d/);
  });

  it('describes the crawl for a static fixture', () => {
    const result = CrawlCoverage.audit({
      SiteCrawl: /** @type {any} */ ({
        state: 'crawled',
        auditedUrl: 'https://example.com/',
        reason: null,
        auditedRenderedTextLength: 100,
        snapshot: {
          version: 1,
          origin: 'https://example.com',
          createdAt: '2026-10-01T00:00:00.000Z',
          bounds: {pages: 50, budgetMs: 120000, robots: 'honour', userAgent: 'x'},
          robots: {state: 'absent'},
          seeds: {audited: 1, links: 0, sitemap: 0},
          pages: [
            {
              url: 'https://example.com/',
              finalUrl: 'https://example.com/',
              redirects: [],
              status: 200,
              contentType: 'text/html',
              bytes: 1,
              truncated: false,
              title: 'T',
              description: null,
              canonicals: [],
              robotsMetas: [],
              xRobotsTag: [],
              h1: [],
              textHash: 'a',
              textLength: 100,
              wordCount: 20,
              links: [],
              source: 'audited',
              extraction: 'ok',
            },
          ],
          skipped: [],
          stats: {requests: 2, elapsedMs: 1, truncatedByBudget: false},
        },
      }),
    });
    expect(result.score).toBe(1);
    expect(result.displayValue).toBe('Crawled 1 of 50 pages');
  });

  it('does not throw when the artifact is missing or null', () => {
    expect(CrawlCoverage.audit({SiteCrawl: /** @type {any} */ (undefined)})).toMatchObject({
      notApplicable: true,
    });
    expect(CrawlCoverage.audit({SiteCrawl: /** @type {any} */ (null)})).toMatchObject({
      notApplicable: true,
    });
  });
});
