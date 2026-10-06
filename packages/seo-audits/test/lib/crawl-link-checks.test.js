/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildBrokenLinksProduct,
  buildRedirectingLinksProduct,
  buildRedirectChainsProduct,
  isLoop,
  MAX_ROWS,
} = require('../../src/lib/crawl-link-checks.js');

const O = 'https://example.com';
const mkUrl = (/** @type {string} */ p) => `${O}${p}`;
const hop = (
  /** @type {string} */ from,
  /** @type {number} */ status,
  /** @type {string} */ to
) => ({
  url: mkUrl(from),
  status,
  location: mkUrl(to),
});
/** @param {string} path @param {any} [over] */
const page = (path, over = {}) => {
  const built = {
    url: mkUrl(path),
    finalUrl: mkUrl(path),
    status: 200,
    redirects: [],
    extraction: 'ok',
    source: 'link',
    links: [],
    ...over,
  };
  built.links = built.links.map((/** @type {any} */ l) =>
    typeof l === 'string' ? {url: mkUrl(l), nofollow: false, anchor: ''} : l
  );
  return built;
};
/** @param {string} path @param {any} [over] */
const audited = (path, over = {}) => page(path, {source: 'audited', ...over});
/** @param {any[]} pages @param {any} [extra] */
const artifact = (pages, extra = {}) => ({
  state: 'crawled',
  auditedUrl: pages[0].url,
  reason: null,
  auditedRenderedTextLength: null,
  linkChecks: null,
  snapshot: {origin: O, pages, skipped: []},
  ...extra,
});
const checkOf = (
  /** @type {string} */ path,
  /** @type {number | null} */ status,
  hops = [],
  state = 'checked'
) => ({
  url: mkUrl(path),
  finalUrl: hops.length ? hops[hops.length - 1].location : mkUrl(path),
  status,
  redirects: hops,
  state,
});

const builders = {
  'broken-internal-links': buildBrokenLinksProduct,
  'redirecting-internal-links': buildRedirectingLinksProduct,
  'internal-redirect-chains': buildRedirectChainsProduct,
};

describe.each(Object.entries(builders))('%s: cases shared by every audit', (_name, build) => {
  it.each([null, undefined, {}, 5, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(build(input).notApplicable).toBe(true);
    }
  );

  it('is not applicable when no crawled page has an internal link', () => {
    // @ts-expect-error - partial test artifact
    expect(build(artifact([audited('/')])).notApplicable).toBe(true);
  });

  it('passes a site whose links all resolve directly, saying how many targets were checked', () => {
    // @ts-expect-error - partial test artifact
    const product = build(artifact([audited('/', {links: ['/a']}), page('/a')]));
    expect(product.score).toBe(1);
    expect(product.displayValue).toMatch(/all 1 distinct link target checked/);
  });

  it('says how many link targets the crawl neither read nor checked', () => {
    // @ts-expect-error - partial test artifact
    const product = build(artifact([audited('/', {links: ['/a', '/never']}), page('/a')]));
    expect(product.displayValue).toMatch(
      /1 of 2 distinct link targets checked, the rest were not reached/
    );
  });
});

describe('broken-internal-links', () => {
  const run = (/** @type {any[]} */ pages, extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildBrokenLinksProduct(artifact(pages, extra));

  it('fails a link to a 404 or 500 page, and to a page that did not answer', () => {
    const product = run([
      audited('/', {links: ['/a', '/b', '/c']}),
      page('/a', {status: 404, extraction: 'skipped-status'}),
      page('/b', {status: 500, extraction: 'skipped-status'}),
      page('/c', {status: null, extraction: 'error'}),
    ]);
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('3 broken links on 1 page');
    expect(product.details.items.map((/** @type {any} */ i) => i.result)).toEqual([
      'HTTP 404',
      'HTTP 500',
      'no answer',
    ]);
  });

  it('does not judge 401, 403 and 429 (bot protection), and says how many it skipped', () => {
    const blockedOnly = run([
      audited('/', {links: ['/a', '/b', '/c']}),
      page('/a', {status: 403, extraction: 'skipped-status'}),
      page('/b', {status: 429, extraction: 'skipped-status'}),
      page('/c', {status: 401, extraction: 'skipped-status'}),
    ]);
    expect(blockedOnly.score).toBe(1);
    expect(blockedOnly.displayValue).toMatch(/3 links answered 401, 403 or 429/);
    const mixed = run([
      audited('/', {links: ['/a', '/b']}),
      page('/a', {status: 403, extraction: 'skipped-status'}),
      page('/b', {status: 404, extraction: 'skipped-status'}),
    ]);
    expect(mixed.score).toBe(0);
    expect(mixed.displayValue).toBe('1 broken link on 1 page');
    expect(mixed.details.items).toHaveLength(1);
  });

  it('judges every crawled page’s links and puts the audited page’s rows first', () => {
    const product = run([
      audited('/', {links: ['/ok', '/gone1']}),
      page('/other', {links: ['/gone2']}),
      page('/ok'),
      page('/gone1', {status: 404, extraction: 'skipped-status'}),
      page('/gone2', {status: 404, extraction: 'skipped-status'}),
    ]);
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('2 broken links on 2 pages');
    expect(product.details.items[0].page).toBe(mkUrl('/'));
    expect(product.details.items[1].page).toBe(mkUrl('/other'));
  });

  it('counts a target once per page however often it is linked', () => {
    const product = run([
      audited('/', {links: ['/gone', {url: mkUrl('/gone'), nofollow: false, anchor: 'again'}]}),
      page('/gone', {status: 404, extraction: 'skipped-status'}),
    ]);
    expect(product.displayValue).toBe('1 broken link on 1 page');
  });

  it('uses the status checks of the audited page’s own links', () => {
    const product = run([audited('/', {links: ['/a']}), page('/a')], {
      linkChecks: {checked: [checkOf('/dead', 404), checkOf('/fine', 200)], notChecked: 0},
    });
    expect(product.score).toBe(0);
    expect(product.details.items).toHaveLength(1);
    expect(product.details.items[0].target).toBe(mkUrl('/dead'));
    expect(product.details.items[0].page).toBe(mkUrl('/'));
  });

  it('does not use link checks for a link on another page, and does not claim a robots-blocked link is fine or broken', () => {
    const product = run([audited('/', {links: ['/a']}), page('/a', {links: ['/dead']})], {
      linkChecks: {
        checked: [checkOf('/dead', 404), checkOf('/blocked', null, [], 'blocked-by-robots')],
        notChecked: 0,
      },
    });
    // The /dead check came from the audited page's own links, so it is reported against the audited page only.
    expect(product.details.items.every((/** @type {any} */ i) => i.page === mkUrl('/'))).toBe(true);
    expect(JSON.stringify(product.details.items)).not.toMatch(/blocked/);
  });

  it('flags a redirect that ends in an error, naming the redirect', () => {
    const product = run([
      audited('/', {links: ['/old']}),
      page('/old', {
        status: 404,
        redirects: [hop('/old', 301, '/gone')],
        finalUrl: mkUrl('/gone'),
        extraction: 'skipped-status',
      }),
    ]);
    expect(product.score).toBe(0);
    expect(product.details.items[0].note).toBe('after 1 redirect');
  });

  it('caps the rows', () => {
    const paths = Array.from({length: 80}, (_, i) => `/g${i}`);
    const product = run([
      audited('/', {links: paths}),
      ...paths.map(p => page(p, {status: 404, extraction: 'skipped-status'})),
    ]);
    expect(product.details.items).toHaveLength(MAX_ROWS + 1);
    expect(product.details.items[MAX_ROWS].page).toBe('30 more not shown');
  });
});

describe('redirecting-internal-links', () => {
  const redirecting = (/** @type {number} */ status) => [
    audited('/', {links: ['/old']}),
    page('/old', {redirects: [hop('/old', status, '/new')], finalUrl: mkUrl('/new')}),
    page('/new'),
  ];
  const run = (/** @type {any[]} */ pages, extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildRedirectingLinksProduct(artifact(pages, extra));

  it.each([301, 308])('fails a link to a permanent redirect (%i)', status => {
    const product = run(redirecting(status));
    expect(product.score).toBe(0.5);
    expect(product.details.items[0]).toMatchObject({
      result: `${status} to ${mkUrl('/new')}`,
      note: 'permanent redirect: link to the final URL',
    });
  });

  it.each([302, 303, 307])('lists a link to a temporary redirect (%i) without failing', status => {
    const product = run(redirecting(status));
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('1 temporary redirect (not failing)');
    expect(product.details.items[0].note).toBe('temporary redirect, not failing');
  });

  it('mentions the temporary ones in a failing explanation', () => {
    const product = run([
      audited('/', {links: ['/old', '/tmp']}),
      page('/old', {redirects: [hop('/old', 301, '/new')], finalUrl: mkUrl('/new')}),
      page('/tmp', {redirects: [hop('/tmp', 302, '/new')], finalUrl: mkUrl('/new')}),
      page('/new'),
    ]);
    expect(product.score).toBe(0.5);
    expect(product.explanation).toMatch(
      /1 link to a temporary redirect is also listed, not judged/
    );
  });

  it('leaves chains and loops to internal-redirect-chains', () => {
    const product = run([
      audited('/', {links: ['/a']}),
      page('/a', {redirects: [hop('/a', 301, '/b'), hop('/b', 301, '/c')], finalUrl: mkUrl('/c')}),
    ]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toMatch(/^No redirecting links/);
  });

  it('uses the audited page’s link checks, and finds a link to the final URL fine', () => {
    const product = run([audited('/', {links: ['/a']}), page('/a')], {
      linkChecks: {checked: [checkOf('/old', 200, [hop('/old', 301, '/new')])], notChecked: 0},
    });
    expect(product.score).toBe(0.5);
    const fine = run([audited('/', {links: ['/new']}), page('/new')]);
    expect(fine.score).toBe(1);
  });

  it('judges a link to a page that was reached by another page’s redirect as a direct link', () => {
    const product = run([
      audited('/', {links: ['/new', '/old']}),
      page('/old', {redirects: [hop('/old', 301, '/new')], finalUrl: mkUrl('/new')}),
      page('/new'),
    ]);
    expect(product.details.items).toHaveLength(1);
    expect(product.details.items[0].target).toBe(mkUrl('/old'));
  });
});

describe('redirects whose destination the crawl already held', () => {
  // The crawler does not follow a redirect to a URL it already requested, so the entry stops on the 3xx.
  const stopped = (
    /** @type {string} */ from,
    /** @type {number} */ status,
    /** @type {string} */ to
  ) => page(from, {status, redirects: [hop(from, status, to)], extraction: 'skipped-status'});

  it('shows the real destination of a temporary redirect, not the page it started on', () => {
    // @ts-expect-error - partial test artifact
    const product = buildRedirectingLinksProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited('/', {links: ['/tmp']}), page('/ok'), stopped('/tmp', 302, '/ok')])
    );
    expect(product.details.items[0].result).toBe(`302 to ${mkUrl('/ok')}`);
  });

  it('counts a redirect into an already-crawled broken page as broken', () => {
    const product = buildBrokenLinksProduct(
      // @ts-expect-error - partial test artifact
      artifact([
        audited('/', {links: ['/old']}),
        page('/gone', {status: 404, extraction: 'skipped-status'}),
        stopped('/old', 301, '/gone'),
      ])
    );
    expect(product.score).toBe(0);
    expect(product.details.items[0]).toMatchObject({target: mkUrl('/old'), result: 'HTTP 404'});
  });

  it('adds the hops of a redirecting page it lands on, so a chain through crawled pages is found', () => {
    const product = buildRedirectChainsProduct(
      // @ts-expect-error - partial test artifact
      artifact([
        audited('/', {links: ['/a']}),
        page('/b', {redirects: [hop('/b', 301, '/c')], finalUrl: mkUrl('/c')}),
        page('/c'),
        stopped('/a', 301, '/b'),
      ])
    );
    expect(product.score).toBe(0.5);
    expect(product.details.items[0].note).toBe('301 > 301');
  });

  it('terminates on a loop made of crawled pages', () => {
    const product = buildRedirectChainsProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited('/', {links: ['/a']}), stopped('/a', 301, '/b'), stopped('/b', 301, '/a')])
    );
    expect(product.score).toBe(0);
    expect(product.details.items[0].result).toMatch(/^loop after/);
  });
});

describe('internal-redirect-chains', () => {
  const run = (/** @type {any[]} */ pages, extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildRedirectChainsProduct(artifact(pages, extra));

  it('fails a link that redirects twice, whatever the statuses, listing the statuses', () => {
    const product = run([
      audited('/', {links: ['/a']}),
      page('/a', {redirects: [hop('/a', 302, '/b'), hop('/b', 301, '/c')], finalUrl: mkUrl('/c')}),
    ]);
    expect(product.score).toBe(0.5);
    expect(product.details.items[0]).toMatchObject({
      result: `2 hops to ${mkUrl('/c')}`,
      note: '302 > 301',
    });
  });

  it('passes a single redirect', () => {
    const product = run([
      audited('/', {links: ['/a']}),
      page('/a', {redirects: [hop('/a', 301, '/b')], finalUrl: mkUrl('/b')}),
    ]);
    expect(product.score).toBe(1);
  });

  it('fails a redirect loop and says so', () => {
    const product = run([
      audited('/', {links: ['/a']}),
      page('/a', {
        redirects: [hop('/a', 301, '/b'), hop('/b', 301, '/a')],
        finalUrl: mkUrl('/b'),
        extraction: 'skipped-status',
      }),
    ]);
    expect(product.score).toBe(0);
    expect(product.details.items[0].result).toBe('loop after 2 hops');
    expect(product.explanation).toMatch(/1 of them in a circle/);
  });

  it('fails a single redirect straight back to itself as a loop', () => {
    expect(isLoop([hop('/a', 301, '/a')])).toBe(true);
    expect(isLoop([hop('/a', 301, '/b')])).toBe(false);
    expect(isLoop([])).toBe(false);
    expect(isLoop([{url: mkUrl('/a'), status: 301, location: null}])).toBe(false);
  });

  it('uses the audited page’s link checks', () => {
    const product = run([audited('/', {links: ['/a']}), page('/a')], {
      linkChecks: {
        checked: [checkOf('/old', 200, [hop('/old', 301, '/mid'), hop('/mid', 301, '/new')])],
        notChecked: 0,
      },
    });
    expect(product.score).toBe(0.5);
  });
});
