/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildCoverageProduct,
  scriptBuiltContent,
  MAX_ROWS,
} = require('../../src/lib/crawl-coverage.js');

const A = 'https://example.com/';
/** @param {any} over */
const page = (over = {}) => {
  const built = {
    url: A,
    finalUrl: A,
    redirects: [],
    status: 200,
    contentType: 'text/html',
    bytes: 100,
    truncated: false,
    title: 'Home',
    description: null,
    canonicals: [],
    robotsMetas: [],
    xRobotsTag: [],
    h1: [],
    textHash: 'abc',
    textLength: 500,
    wordCount: 80,
    links: [],
    externalLinks: [],
    pagination: {next: [], prev: []},
    depth: 0,
    source: 'audited',
    extraction: 'ok',
    ...over,
  };
  // A page is not redirected unless the test says so.
  if (!('finalUrl' in over)) built.finalUrl = built.url;
  return built;
};
/** @param {any} over */
const snapshot = (over = {}) => ({
  version: 2,
  origin: 'https://example.com',
  createdAt: '2026-10-01T00:00:00.000Z',
  bounds: {pages: 50, depth: 3, budgetMs: 120000, robots: 'honour', userAgent: 'x'},
  robots: {state: 'present'},
  seeds: {audited: 1, home: 0, links: 0, sitemap: 0},
  sitemapUrls: [],
  pages: [page()],
  skipped: [],
  stats: {
    requests: 2,
    elapsedMs: 10,
    truncatedByBudget: false,
    overPageCap: false,
    cutByDepth: false,
  },
  ...over,
});
/** @param {any} over */
const artifact = (over = {}) => ({
  state: 'crawled',
  auditedUrl: A,
  reason: null,
  snapshot: snapshot(),
  auditedRenderedTextLength: 500,
  ...over,
});
const notes = (/** @type {any} */ product) =>
  product.details.items
    .filter((/** @type {any} */ i) => i.url.startsWith('Note: '))
    .map((/** @type {any} */ i) => i.url);

describe('not applicable', () => {
  it('without an artifact, with a non-object, when disabled, and when unavailable', () => {
    for (const a of [null, undefined, 'x', 5]) {
      expect(buildCoverageProduct(/** @type {any} */ (a))).toMatchObject({
        score: 1,
        notApplicable: true,
      });
    }
    const disabled = buildCoverageProduct(
      artifact({state: 'disabled', reason: 'switched off', snapshot: null})
    );
    expect(disabled).toMatchObject({notApplicable: true, explanation: 'switched off'});
    const unavailable = buildCoverageProduct(
      artifact({state: 'unavailable', reason: 'no page could be requested: boom', snapshot: null})
    );
    expect(unavailable).toMatchObject({
      notApplicable: true,
      explanation: 'no page could be requested: boom',
    });
    expect(
      buildCoverageProduct(artifact({state: 'unavailable', reason: null, snapshot: null}))
        .explanation
    ).toMatch(/could not run/);
  });

  it('when the snapshot is missing or malformed, without throwing', () => {
    expect(buildCoverageProduct(artifact({snapshot: null}))).toMatchObject({notApplicable: true});
    expect(buildCoverageProduct(artifact({snapshot: {pages: 'x'}}))).toMatchObject({
      notApplicable: true,
    });
  });
});

describe('the display value', () => {
  it('counts crawled pages against the cap', () => {
    const p = buildCoverageProduct(
      artifact({
        snapshot: snapshot({pages: [page(), page({url: 'https://example.com/a', source: 'link'})]}),
      })
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('Crawled 2 of 50 pages');
  });

  it('adds blocked and error counts, in the singular and the plural', () => {
    const p = buildCoverageProduct(
      artifact({
        snapshot: snapshot({
          pages: [
            page(),
            page({url: 'https://example.com/e', status: null, extraction: 'error'}),
            page({url: 'https://example.com/x', status: 500, extraction: 'skipped-status'}),
          ],
          skipped: [
            {url: 'https://example.com/p1', reason: 'blocked-by-robots', detail: null},
            {url: 'https://example.com/p2', reason: 'blocked-by-robots', detail: null},
          ],
        }),
      })
    );
    expect(p.displayValue).toBe('Crawled 1 of 50 pages (2 blocked by robots.txt, 2 errors)');
    const one = buildCoverageProduct(
      artifact({
        snapshot: snapshot({
          bounds: {pages: 1, budgetMs: 1, robots: 'honour', userAgent: 'x'},
          pages: [page({status: null, extraction: 'error'})],
        }),
      })
    );
    expect(one.displayValue).toBe('Crawled 0 of 1 page (1 error)');
  });
});

describe('the table', () => {
  it('has a row per page with its status, title, words and how it was found', () => {
    const p = buildCoverageProduct(
      artifact({
        snapshot: snapshot({
          pages: [
            page(),
            page({
              url: 'https://example.com/a',
              source: 'link',
              depth: 2,
              title: 'A',
              wordCount: 10,
            }),
            page({url: 'https://example.com/m', source: 'sitemap', title: 'M'}),
          ],
        }),
      })
    );
    const rows = p.details.items.filter((/** @type {any} */ i) => !i.url.startsWith('Note: '));
    expect(
      rows.map((/** @type {any} */ r) => [r.url, r.status, r.depth, r.title, r.words, r.source])
    ).toEqual([
      [A, '200', 0, 'Home', 80, 'audited page'],
      ['https://example.com/a', '200', 2, 'A', 10, 'link on a page'],
      ['https://example.com/m', '200', 0, 'M', 80, 'sitemap'],
    ]);
    expect(p.details.headings.map((/** @type {any} */ h) => h.label)).toContain('Depth');
  });

  it('describes redirects, non-HTML pages and failures', () => {
    const p = buildCoverageProduct(
      artifact({
        snapshot: snapshot({
          pages: [
            page({url: 'https://example.com/old', finalUrl: 'https://example.com/new'}),
            page({url: 'https://example.com/doc.pdf', extraction: 'skipped-not-html'}),
            page({url: 'https://example.com/down', status: null, extraction: 'error'}),
            page({url: 'https://example.com/gone', status: 404, extraction: 'skipped-status'}),
          ],
        }),
      })
    );
    const rows = p.details.items.filter((/** @type {any} */ i) => !i.url.startsWith('Note: '));
    expect(rows[0].url).toBe('https://example.com/old -> https://example.com/new');
    expect(rows[1]).toMatchObject({status: '200 (not HTML)', words: ''});
    expect(rows[2]).toMatchObject({status: 'error (no response)'});
    expect(rows[3]).toMatchObject({status: '404', words: ''});
  });

  it('lists the skipped URLs with a readable reason', () => {
    const p = buildCoverageProduct(
      artifact({
        snapshot: snapshot({
          skipped: [
            {url: 'https://example.com/p', reason: 'blocked-by-robots', detail: null},
            {url: 'https://other.test/x', reason: 'cross-origin', detail: null},
            {url: 'https://example.com/z', reason: 'over-page-cap', detail: null},
            {
              url: 'https://example.com/n',
              reason: 'not-checked',
              detail: 'the crawl time budget ran out',
            },
            {url: 'https://example.com/f', reason: 'failed', detail: null},
          ],
        }),
      })
    );
    const statuses = p.details.items.map((/** @type {any} */ i) => i.status).filter(Boolean);
    expect(statuses).toEqual([
      '200',
      'blocked by robots.txt',
      'other origin, not requested',
      'over the page cap',
      'not checked',
      'failed',
    ]);
  });

  it(`caps the table at ${MAX_ROWS} rows including the notes, and says how many are left out`, () => {
    const pages = Array.from({length: 150}, (_, i) => page({url: `https://example.com/p${i}`}));
    const p = buildCoverageProduct(artifact({snapshot: snapshot({pages})}));
    expect(p.details.items).toHaveLength(MAX_ROWS + 1);
    expect(p.details.items[MAX_ROWS].url).toMatch(/^\d+ more not shown$/);
  });

  it('cuts an enormous URL and title', () => {
    const p = buildCoverageProduct(
      artifact({
        snapshot: snapshot({
          pages: [
            page({
              url: `https://example.com/${'a'.repeat(5000)}`,
              finalUrl: `https://example.com/${'a'.repeat(5000)}`,
              title: 't'.repeat(5000),
            }),
          ],
        }),
      })
    );
    const row = p.details.items.find((/** @type {any} */ i) => i.title);
    expect(row.url.length).toBeLessThan(250);
    expect(row.title.length).toBeLessThan(150);
  });
});

describe('the notes', () => {
  it('always say the crawl reads server HTML only', () => {
    expect(
      notes(buildCoverageProduct(artifact())).some((/** @type {string} */ n) =>
        /server HTML only/.test(n)
      )
    ).toBe(true);
  });

  it('say when the crawl was reused from the cache, with when it was made', () => {
    const n = notes(buildCoverageProduct(artifact({state: 'cached'})));
    expect(
      n.some((/** @type {string} */ t) => /Reused from a crawl made at 2026-10-01/.test(t))
    ).toBe(true);
  });

  it('say when the time budget or the page cap limited the crawl', () => {
    const p = buildCoverageProduct(
      artifact({
        snapshot: snapshot({
          stats: {
            requests: 5,
            elapsedMs: 1,
            truncatedByBudget: true,
            overPageCap: true,
            cutByDepth: false,
          },
          skipped: [{url: 'https://example.com/z', reason: 'over-page-cap', detail: null}],
        }),
      })
    );
    const n = notes(p).join('\n');
    expect(n).toMatch(/stopped at its time budget \(120 s\)/);
    expect(n).toMatch(/more pages were found than the page cap \(50\).*deepest were left out/i);
    expect(n).toMatch(/LHCI_SEO_CRAWL_MAX_PAGES/);
  });

  it('say when the crawl was cut by the depth bound, naming the bound', () => {
    const cut = (/** @type {number} */ depth) =>
      notes(
        buildCoverageProduct(
          artifact({
            snapshot: snapshot({
              bounds: {pages: 50, depth, budgetMs: 120000, robots: 'honour', userAgent: 'x'},
              stats: {
                requests: 5,
                elapsedMs: 1,
                truncatedByBudget: false,
                overPageCap: false,
                cutByDepth: true,
              },
            }),
          })
        )
      ).join('\n');
    expect(cut(3)).toMatch(/followed links 3 hops.*LHCI_SEO_CRAWL_MAX_DEPTH/);
    expect(cut(1)).toMatch(/followed links 1 hop from/);
  });

  it('say nothing about the cap or the depth when the crawl was complete', () => {
    const n = notes(buildCoverageProduct(artifact())).join('\n');
    expect(n).not.toMatch(/page cap|hops?|query-string/);
  });

  it('say how many of the audited page’s own links were status-checked, blocked or left unchecked', () => {
    const check = (/** @type {string} */ p, /** @type {string} */ state) => ({
      url: `https://example.com/${p}`,
      finalUrl: `https://example.com/${p}`,
      status: state === 'checked' ? 200 : null,
      redirects: [],
      state,
    });
    const n = notes(
      buildCoverageProduct(
        artifact({
          linkChecks: {
            checked: [
              check('a', 'checked'),
              check('b', 'checked'),
              check('c', 'blocked-by-robots'),
            ],
            notChecked: 4,
          },
        })
      )
    ).join('\n');
    expect(n).toMatch(
      /2 internal links of the audited page that the crawl did not read were status-checked/
    );
    expect(n).toMatch(/1 disallowed by robots\.txt, not requested/);
    expect(n).toMatch(/4 more not checked.*LHCI_SEO_CRAWL_MAX_LINK_CHECKS/);
    expect(
      notes(buildCoverageProduct(artifact({linkChecks: {checked: [], notChecked: 0}}))).join('\n')
    ).not.toMatch(/status-checked/);
    expect(notes(buildCoverageProduct(artifact())).join('\n')).not.toMatch(/status-checked/);
  });

  it('count the URLs left out by the query-variant guard', () => {
    const skipped = [1, 2, 3].map(i => ({
      url: `https://example.com/list?page=${i}`,
      reason: 'query-variants',
      detail: null,
    }));
    const p = buildCoverageProduct(artifact({snapshot: snapshot({skipped})}));
    expect(notes(p).join('\n')).toMatch(/3 URLs with more than 5 query-string variants/);
    expect(
      p.details.items.filter(
        (/** @type {any} */ i) => i.status === 'too many query-string variants of one path'
      )
    ).toHaveLength(3);
  });

  it('describe each robots.txt state', () => {
    const state = (/** @type {string} */ s, /** @type {any[]} */ skipped = []) =>
      notes(
        buildCoverageProduct(artifact({snapshot: snapshot({robots: {state: s}, skipped})}))
      ).join('\n');
    expect(state('unavailable')).toMatch(/could not be read, so only the audited page/);
    expect(state('ignored')).toMatch(/was ignored/);
    expect(state('present', [{url: 'x', reason: 'blocked-by-robots', detail: null}])).toMatch(
      /disallowed 1 URL,/
    );
    expect(state('present')).not.toMatch(/disallowed/);
    expect(state('absent')).not.toMatch(/robots.txt/);
  });
});

describe('script-built content', () => {
  it('is detected when a browser shows far more text than the server HTML', () => {
    const a = artifact({
      auditedRenderedTextLength: 2000,
      snapshot: snapshot({pages: [page({textLength: 40})]}),
    });
    expect(scriptBuiltContent(a)).toEqual({rendered: 2000, server: 40});
    const note = notes(buildCoverageProduct(a)).join('\n');
    expect(note).toMatch(/built by script/);
    // It must not claim script is the only explanation: a server can also answer a crawler differently.
    expect(note).toMatch(/answers the crawler differently from a browser/);
  });

  it('is not claimed for a normal page, a small difference, or missing data', () => {
    expect(
      scriptBuiltContent(
        artifact({
          auditedRenderedTextLength: 520,
          snapshot: snapshot({pages: [page({textLength: 500})]}),
        })
      )
    ).toBeNull();
    expect(
      scriptBuiltContent(
        artifact({
          auditedRenderedTextLength: 150,
          snapshot: snapshot({pages: [page({textLength: 0})]}),
        })
      )
    ).toBeNull();
    expect(scriptBuiltContent(artifact({auditedRenderedTextLength: null}))).toBeNull();
    expect(scriptBuiltContent(artifact({snapshot: null}))).toBeNull();
    expect(
      scriptBuiltContent(
        artifact({
          auditedRenderedTextLength: 5000,
          snapshot: snapshot({pages: [page({source: 'link'})]}),
        })
      )
    ).toBeNull();
    expect(
      scriptBuiltContent(
        artifact({
          auditedRenderedTextLength: 5000,
          snapshot: snapshot({pages: [page({extraction: 'error', textLength: 0})]}),
        })
      )
    ).toBeNull();
  });
});
