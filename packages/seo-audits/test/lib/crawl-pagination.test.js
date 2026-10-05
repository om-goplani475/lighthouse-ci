/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildPaginationLinksProduct,
  buildPaginatedCanonicalProduct,
  buildPaginationTrapProduct,
  seriesOf,
  MAX_ROWS,
} = require('../../src/lib/crawl-pagination.js');

const O = 'https://example.com';
const mkUrl = (/** @type {string} */ p) => `${O}${p}`;
const list = (/** @type {number} */ n) => mkUrl(`/list?page=${n}`);
/** @param {string} url @param {any} [over] */
const page = (url, over = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  truncated: false,
  extraction: 'ok',
  source: 'link',
  canonicals: [],
  links: [],
  pagination: {next: [], prev: []},
  ...over,
});
/** @param {string} url @param {any} [over] */
const audited = (url, over = {}) => page(url, {source: 'audited', ...over});
const pag = (/** @type {string[]} */ prev, /** @type {string[]} */ next) => ({
  pagination: {prev, next},
});
/** @param {any[]} pages @param {any} [extra] @param {any[]} [skipped] */
const artifact = (pages, extra = {}, skipped = []) => ({
  state: 'crawled',
  auditedUrl: pages[0].url,
  reason: null,
  auditedRenderedTextLength: null,
  linkChecks: null,
  snapshot: {
    origin: O,
    robots: {state: 'present'},
    pages,
    skipped,
    stats: {truncatedByBudget: false, overPageCap: false, cutByDepth: false},
  },
  ...extra,
});
const check = (/** @type {string} */ url, /** @type {number | null} */ status, hops = []) => ({
  url,
  finalUrl: hops.length ? hops[hops.length - 1].location : url,
  status,
  redirects: hops,
  state: 'checked',
});

describe.each([
  ['pagination-links', buildPaginationLinksProduct],
  ['paginated-canonical', buildPaginatedCanonicalProduct],
  ['pagination-trap', buildPaginationTrapProduct],
])('%s: cases shared by every audit', (_name, build) => {
  it.each([null, undefined, {}, 5, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(build(input).notApplicable).toBe(true);
    }
  );

  it('is not applicable when the audited page was not read as HTML', () => {
    // @ts-expect-error - partial test artifact
    expect(build(artifact([audited(list(2), {extraction: 'error'})])).notApplicable).toBe(true);
  });

  it('is not applicable for a page that is not part of any series', () => {
    // @ts-expect-error - partial test artifact
    expect(build(artifact([audited(mkUrl('/about')), page(mkUrl('/'))])).notApplicable).toBe(true);
  });
});

describe('pagination-links', () => {
  const run = (/** @type {any[]} */ pages, extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildPaginationLinksProduct(artifact(pages, extra));

  it('passes a page whose neighbours exist and link back', () => {
    const product = run([
      audited(list(2), pag([list(1)], [list(3)])),
      page(list(1), pag([], [list(2)])),
      page(list(3), pag([list(2)], [])),
    ]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('2 pagination links checked');
  });

  it('fails a link to a page that does not link back, naming the missing relation', () => {
    const product = run([audited(list(2), pag([], [list(3)])), page(list(3), pag([list(1)], []))]);
    expect(product.score).toBe(0);
    expect(product.explanation).toMatch(/rel=next does not link back with rel=prev/);
  });

  it('fails a target that is broken, in the crawl or in the status checks', () => {
    const crawled = run([
      audited(list(2), pag([], [list(3)])),
      page(list(3), {status: 404, extraction: 'skipped-status'}),
    ]);
    expect(crawled.score).toBe(0);
    expect(crawled.details.items[0].result).toBe('HTTP 404');
    const checked = run([audited(list(2), pag([list(1)], []))], {
      linkChecks: {checked: [check(list(1), 500)], notChecked: 0},
    });
    expect(checked.score).toBe(0);
    expect(checked.details.items[0].result).toBe('HTTP 500');
    const silent = run([audited(list(2), pag([list(1)], []))], {
      linkChecks: {checked: [check(list(1), null)], notChecked: 0},
    });
    expect(silent.details.items[0].result).toBe('no answer');
  });

  it('fails a page that points at itself', () => {
    const product = run([audited(list(2), pag([], [list(2)]))]);
    expect(product.score).toBe(0);
    expect(product.details.items[0].result).toBe('points to itself');
  });

  it('fails a rel=next chain that loops back', () => {
    const product = run([
      audited(list(1), pag([], [list(2)])),
      page(list(2), pag([list(1)], [list(3)])),
      page(list(3), pag([list(2)], [list(1)])),
    ]);
    expect(product.score).toBe(0);
    expect(product.details.items.map((/** @type {any} */ i) => i.result)).toContain(
      'loops back to a page already visited'
    );
  });

  it('terminates on a long chain', () => {
    const pages = [audited(list(0), pag([], [list(1)]))];
    for (let i = 1; i < 120; i++) pages.push(page(list(i), pag([list(i - 1)], [list(i + 1)])));
    expect(() => run(pages)).not.toThrow();
  });

  it('is a note, not a failure, for a target that redirects, and says where to', () => {
    const product = run([audited(list(2), pag([list(1)], []))], {
      linkChecks: {
        checked: [
          check(list(1), 200, [{url: list(1), status: 301, location: mkUrl('/list?page=1&x=1')}]),
        ],
        notChecked: 0,
      },
    });
    expect(product.score).toBe(1);
    expect(product.details.items[0].note).toMatch(/redirects to .*link to the final URL/);
  });

  it('does not check reciprocity for a target the crawl did not read, and says so', () => {
    const product = run([audited(list(2), pag([list(1)], []))], {
      linkChecks: {checked: [check(list(1), 200)], notChecked: 0},
    });
    expect(product.score).toBe(1);
    expect(product.details.items[0].note).toMatch(/links back not checked/);
  });

  it('does not judge a target on another origin', () => {
    const product = run([audited(list(2), pag([], ['https://other.test/list?page=3']))]);
    expect(product.score).toBe(1);
    expect(product.details.items[0]).toMatchObject({result: 'other origin', note: 'not checked'});
  });

  it('accepts a neighbour that links back through the URL the page redirects from', () => {
    const product = run([
      audited(list(2), {...pag([], [list(3)]), url: mkUrl('/old2'), finalUrl: list(2)}),
      page(list(3), pag([mkUrl('/old2')], [])),
    ]);
    expect(product.score).toBe(1);
  });

  it('lists other crawled pages with problems without failing on them', () => {
    const product = run([
      audited(list(2), pag([list(1)], [list(3)])),
      page(list(1), pag([], [list(2)])),
      page(list(3), pag([list(2)], [])),
      page(list(8), pag([list(7)], [])),
      page(list(7), pag([], [])),
    ]);
    expect(product.score).toBe(1);
    expect(
      product.details.items.some(
        (/** @type {any} */ i) => i.note === 'other crawled page, not judged'
      )
    ).toBe(true);
  });

  it('caps the rows listing other pages', () => {
    const pages = [audited(list(1), pag([], [list(2)])), page(list(2), pag([list(1)], []))];
    for (let i = 0; i < 150; i++) {
      pages.push(page(mkUrl(`/s${i}?page=2`), pag([], [mkUrl(`/s${i}?page=2`)])));
    }
    const product = run(pages);
    expect(product.details.items.length).toBeLessThanOrEqual(MAX_ROWS * 2 + 1);
  });

  it('mentions the other pages in a failing explanation', () => {
    const product = run([audited(list(2), pag([], [list(2)])), page(list(8), pag([], [list(8)]))]);
    expect(product.explanation).toMatch(/1 other crawled page also has pagination problems/);
  });
});

describe('paginated-canonical', () => {
  const run = (/** @type {any[]} */ pages, extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildPaginatedCanonicalProduct(artifact(pages, extra));
  const series = (/** @type {any} */ over) => [
    audited(list(2), {...pag([list(1)], [list(3)]), ...over}),
    page(list(1), pag([], [list(2)])),
    page(list(3), pag([list(2)], [])),
  ];

  it('passes a page that canonicalises itself, or declares none', () => {
    expect(run(series({canonicals: [list(2)]})).score).toBe(1);
    expect(run(series({})).score).toBe(1);
    expect(run(series({canonicals: [list(2)]})).displayValue).toBe(
      'Canonical is the page itself (or absent)'
    );
  });

  it('fails a canonical to page 1 or to another page of the series', () => {
    const toFirst = run(series({canonicals: [list(1)]}));
    expect(toFirst.score).toBe(0);
    expect(toFirst.explanation).toMatch(/canonical points at another page of it/);
    expect(run(series({canonicals: [list(3)]})).score).toBe(0);
  });

  it('resolves a relative canonical', () => {
    expect(run(series({canonicals: ['/list?page=1']})).score).toBe(0);
  });

  it('passes, with a note, a canonical outside the series (a view-all page)', () => {
    const product = run(series({canonicals: [mkUrl('/list?view=all')]}));
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('Canonical points outside the series');
    expect(product.details.items[0].note).toMatch(/view-all/);
  });

  it('is not applicable with several canonicals', () => {
    expect(run(series({canonicals: [list(1), list(3)]})).notApplicable).toBe(true);
  });

  it('knows the series from other pages that point at it, not only from its own links', () => {
    const product = run([
      audited(list(2), {canonicals: [list(1)]}),
      page(list(1), pag([], [list(2)])),
    ]);
    expect(product.score).toBe(0);
  });

  it('lists other pages of the series that canonicalise away, without failing on them', () => {
    const product = run([
      audited(list(2), {...pag([list(1)], [list(3)]), canonicals: [list(2)]}),
      page(list(1), pag([], [list(2)])),
      page(list(3), {...pag([list(2)], []), canonicals: [list(1)]}),
    ]);
    expect(product.score).toBe(1);
    expect(product.details.items[1].note).toMatch(/other page in the series.*not judged/);
  });

  it('builds the series from both directions', () => {
    const members = seriesOf(
      // @ts-expect-error - partial test page
      audited(list(2)),
      // @ts-expect-error - partial test pages
      [page(list(1), pag([], [list(2)])), page(list(3), pag([list(2)], [])), page(mkUrl('/other'))]
    );
    expect([...members].sort()).toEqual([list(1), list(2), list(3)]);
  });
});

describe('pagination-trap', () => {
  const run = (/** @type {any[]} */ pages, skipped = [], extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildPaginationTrapProduct(artifact(pages, extra, skipped));
  const skippedVariants = (/** @type {number} */ n) =>
    Array.from({length: n}, (_, i) => ({
      url: list(20 + i),
      reason: 'query-variants',
      detail: null,
    }));
  /** The audited page and five crawled variants, the last still pointing on. */
  const crawledVariants = () => [
    audited(list(1), pag([], [list(2)])),
    ...[2, 3, 4, 5].map(n => page(list(n), pag([list(n - 1)], [list(n + 1)]))),
  ];

  it('fails a series the crawl had to stop following while rel=next kept going', () => {
    const product = run(crawledVariants(), skippedVariants(4));
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('At least 10 numbered variants, still going');
    expect(product.explanation).toMatch(/endless or very long/);
    expect(product.explanation).toMatch(/A long but finite series looks the same/);
  });

  it('fails a next-only chain the crawl could not follow to its end, once enough variants are known', () => {
    // Crawled 1 to 5 (the depth bound), page 5 points on to 6: six variants known, the last one not followed.
    const pages = [1, 2, 3, 4, 5].map(n =>
      n === 1
        ? audited(list(n), pag([], [list(2)]))
        : page(list(n), pag([list(n - 1)], [list(n + 1)]))
    );
    const product = run(pages);
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('At least 6 numbered variants, still going');
  });

  it('does not call a short series a trap just because the crawl stopped following it', () => {
    // Crawled 1 to 4, page 4 points on to 5: five variants known, not more than the limit.
    const pages = [1, 2, 3, 4].map(n =>
      n === 1
        ? audited(list(n), pag([], [list(2)]))
        : page(list(n), pag([list(n - 1)], [list(n + 1)]))
    );
    const product = run(pages);
    expect(product.score).toBe(1);
    expect(product.details.items[0].note).toMatch(/too few to call it a trap/);
  });

  it('passes a series that ended inside what the crawl followed', () => {
    const product = run([audited(list(1), pag([], [list(2)])), page(list(2), pag([list(1)], []))]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('2 variants of this path seen');
  });

  it('passes when variants were skipped but nothing points forward any more', () => {
    const product = run(
      [audited(list(9), pag([list(8)], [])), page(list(8), pag([list(7)], [list(9)]))].map(p =>
        p.pagination.next.length ? {...p, pagination: {prev: p.pagination.prev, next: []}} : p
      ),
      skippedVariants(2)
    );
    expect(product.score).toBe(1);
    expect(product.details.items[0].note).toMatch(/no rel=next points forward/);
  });

  it('judges a page by its query string even without pagination links', () => {
    const product = run([audited(list(3)), page(list(4), pag([], [list(5)]))], skippedVariants(4));
    expect(product.score).toBe(0);
  });

  it('only counts variants of the same path and origin', () => {
    const product = run(
      [audited(list(1), pag([], [list(2)]))],
      [
        {url: mkUrl('/other?page=2'), reason: 'query-variants', detail: null},
        {url: 'https://other.test/list?page=2', reason: 'query-variants', detail: null},
        {url: list(30), reason: 'blocked-by-robots', detail: null},
      ]
    );
    expect(product.score).toBe(1);
  });

  it('is not applicable for a page with neither a query string nor pagination links', () => {
    expect(run([audited(mkUrl('/about'))], skippedVariants(3)).notApplicable).toBe(true);
  });

  it('says how many it saw even with a huge number of skipped variants', () => {
    const product = run(crawledVariants(), skippedVariants(500));
    expect(product.score).toBe(0);
    expect(product.details.items).toHaveLength(1);
  });
});
