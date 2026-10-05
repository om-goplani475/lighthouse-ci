/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildDeadEndProduct,
  buildLinkCountsProduct,
  buildOrphanProduct,
  buildCrawlDepthProduct,
  MAX_DEPTH,
  MAX_OUTLINKS,
  MAX_ROWS,
} = require('../../src/lib/crawl-link-audits.js');

const O = 'https://example.com';
const mkUrl = (/** @type {string} */ p) => `${O}${p}`;
/** @param {string} path @param {any} [over] */
const page = (path, over = {}) => {
  const built = {
    url: mkUrl(path),
    finalUrl: mkUrl(path),
    status: 200,
    truncated: false,
    extraction: 'ok',
    source: 'link',
    depth: 1,
    links: [],
    ...over,
  };
  built.links = built.links.map((/** @type {any} */ l) =>
    typeof l === 'string' ? {url: mkUrl(l), nofollow: false, anchor: ''} : l
  );
  return built;
};
/** @param {string} path @param {any} [over] */
const audited = (path, over = {}) => page(path, {source: 'audited', depth: 0, ...over});
/** @param {any[]} pages @param {any} [over] @param {any} [extra] */
const artifact = (pages, over = {}, extra = {}) => ({
  state: 'crawled',
  auditedUrl: pages[0].url,
  reason: null,
  auditedRenderedTextLength: null,
  snapshot: {
    origin: O,
    robots: {state: 'present'},
    pages,
    skipped: [],
    stats: {truncatedByBudget: false, overPageCap: false, cutByDepth: false},
    ...over,
  },
  ...extra,
});
const partial = {stats: {truncatedByBudget: false, overPageCap: true, cutByDepth: false}};
const links = (/** @type {number} */ n, prefix = '/x') =>
  Array.from({length: n}, (_, i) => `${prefix}${i}`);
/** @param {number} n @param {string} prefix */
const leaves = (n, prefix = '/x') => links(n, prefix).map(p => page(p));

const builders = {
  'dead-end-pages': buildDeadEndProduct,
  'internal-link-counts': buildLinkCountsProduct,
  'orphan-pages': buildOrphanProduct,
  'crawl-depth': buildCrawlDepthProduct,
};

describe.each(Object.entries(builders))('%s: cases shared by every audit', (_name, build) => {
  it.each([null, undefined, {}, 5, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(build(input).notApplicable).toBe(true);
    }
  );

  it('is not applicable when the audited page was not read as HTML', () => {
    // @ts-expect-error - partial test artifact
    expect(build(artifact([audited('/', {extraction: 'error'}), page('/a')])).notApplicable).toBe(
      true
    );
  });

  it('is not applicable when the audited page looks script-built', () => {
    const product = build(
      // @ts-expect-error - partial test artifact
      artifact(
        [audited('/a', {textLength: 10, wordCount: 3}), page('/', {links: ['/a']})],
        {},
        {auditedRenderedTextLength: 5000}
      )
    );
    expect(product.notApplicable).toBe(true);
    expect(product.explanation).toMatch(/cannot be read from server HTML/);
  });
});

describe('dead-end-pages', () => {
  const run = (/** @type {any[]} */ pages) =>
    // @ts-expect-error - partial test artifact
    buildDeadEndProduct(artifact(pages));

  it('fails an audited page with no links at all, and lists other dead ends without failing on them', () => {
    const failing = run([audited('/a'), page('/', {links: ['/a', '/b']}), page('/b')]);
    expect(failing.score).toBe(0);
    expect(failing.displayValue).toBe('No links to other pages');
    expect(failing.explanation).toMatch(/1 other crawled page also has none/);
    const passing = run([audited('/a', {links: ['/']}), page('/'), page('/b')]);
    expect(passing.score).toBe(1);
    expect(passing.details.items).toHaveLength(2);
  });

  it('does not count nofollow links, links to itself or to the same page by another URL', () => {
    const product = run([
      audited('/a', {links: [{url: mkUrl('/'), nofollow: true, anchor: ''}, '/a']}),
      page('/'),
    ]);
    expect(product.score).toBe(0);
  });

  it('counts a link to a page the crawl did not reach', () => {
    const product = run([audited('/a', {links: ['/never-crawled', '/never-crawled', '/other']})]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('2 internal links to other pages');
  });

  it('does not judge pages that were not read as HTML as dead ends', () => {
    const product = run([
      audited('/a', {links: ['/']}),
      page('/', {extraction: 'skipped-not-html'}),
    ]);
    expect(product.details.items).toHaveLength(0);
  });

  it('caps the listed rows', () => {
    const pages = [audited('/a'), ...leaves(80)];
    const product = run(pages);
    expect(product.details.items).toHaveLength(MAX_ROWS + 1);
    expect(product.details.items[MAX_ROWS].page).toBe('31 more not shown');
  });
});

describe('internal-link-counts', () => {
  const run = (/** @type {any[]} */ pages, over = {}) =>
    // @ts-expect-error - partial test artifact
    buildLinkCountsProduct(artifact(pages, over));

  it('fails a page with more internal links than the threshold, and passes one at it', () => {
    const over = run([
      audited('/a', {links: [...links(MAX_OUTLINKS + 1), '/']}),
      page('/', {links: ['/a']}),
      page('/b', {links: ['/a']}),
    ]);
    expect(over.score).toBe(0);
    expect(over.explanation).toMatch(/more than 150/);
    const at = run([
      audited('/a', {links: links(MAX_OUTLINKS)}),
      page('/', {links: ['/a']}),
      page('/b', {links: ['/a']}),
    ]);
    expect(at.score).toBe(1);
  });

  it('fails exactly one inbound link on a complete crawl, and not two', () => {
    const one = run([audited('/a'), page('/', {links: ['/a']})]);
    expect(one.score).toBe(0);
    expect(one.explanation).toMatch(/only 1 crawled page links to it/);
    const two = run([audited('/a'), page('/', {links: ['/a']}), page('/b', {links: ['/a']})]);
    expect(two.score).toBe(1);
    expect(two.displayValue).toBe('2 in, 0 out');
  });

  it('leaves zero inbound links to orphan-pages', () => {
    const product = run([audited('/a'), page('/')]);
    expect(product.score).toBe(1);
    expect(product.details.items[0].note).toMatch(/no inbound links: see orphan-pages/);
  });

  it('does not judge the low side of a partial crawl, and shows the inbound count as a minimum', () => {
    const product = run([audited('/a'), page('/', {links: ['/a']})], partial);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('1+ in, 0 out');
    expect(product.details.items[0].note).toMatch(/crawl was partial/);
  });

  it('still fails too many links on a partial crawl, since that comes from the page itself', () => {
    const product = run(
      [audited('/a', {links: links(MAX_OUTLINKS + 1)}), page('/', {links: ['/a']})],
      partial
    );
    expect(product.score).toBe(0);
  });

  it('does not apply the low side to the homepage', () => {
    const product = run([audited('/', {links: ['/a']}), page('/a', {links: ['/']})]);
    expect(product.score).toBe(1);
  });

  it('counts only followable links from crawled pages', () => {
    const product = run([
      audited('/a'),
      page('/', {links: [{url: mkUrl('/a'), nofollow: true, anchor: ''}]}),
      page('/b', {links: ['/a']}),
      page('/c', {links: ['/a']}),
    ]);
    expect(product.displayValue).toBe('2 in, 0 out');
  });

  it('lists other pages outside the thresholds without failing on them', () => {
    const product = run([
      audited('/a', {links: ['/']}),
      page('/', {links: ['/a', '/b']}),
      page('/b', {links: ['/a', '/c', ...links(MAX_OUTLINKS + 5)]}),
      page('/c', {links: ['/']}),
    ]);
    expect(product.score).toBe(1);
    const notes = product.details.items.map((/** @type {any} */ i) => i.note).join('|');
    expect(notes).toMatch(/other crawled page: over 150 internal links/);
    expect(notes).toMatch(/other crawled page: fewer than 2 pages link here/);
  });
});

describe('orphan-pages', () => {
  const run = (/** @type {any[]} */ pages, over = {}) =>
    // @ts-expect-error - partial test artifact
    buildOrphanProduct(artifact(pages, over));

  it('fails an audited page that no crawled page links to, on a complete crawl', () => {
    const product = run([audited('/a'), page('/', {links: ['/b']}), page('/b')]);
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('No crawled page links to it');
    expect(product.details.items[0].found).toBe('being audited');
  });

  it('passes a page that is linked to, and says by how many pages', () => {
    const product = run([audited('/a'), page('/', {links: ['/a']}), page('/b', {links: ['/a']})]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('2 pages link to it');
  });

  it('does not count a nofollow link, and does count a link through a redirected URL', () => {
    const nofollow = run([
      audited('/a'),
      page('/', {links: [{url: mkUrl('/a'), nofollow: true, anchor: ''}]}),
    ]);
    expect(nofollow.score).toBe(0);
    const redirected = run([
      audited('/new', {url: mkUrl('/old'), finalUrl: mkUrl('/new')}),
      page('/', {links: ['/old']}),
    ]);
    expect(redirected.score).toBe(1);
  });

  it.each([
    ['the page cap', {stats: {overPageCap: true}}, /page cap/],
    ['the depth bound', {stats: {cutByDepth: true}}, /depth bound/],
    ['the time budget', {stats: {truncatedByBudget: true}}, /time budget/],
    ['unreadable robots.txt', {robots: {state: 'unavailable'}}, /robots\.txt could not be read/],
    ['a blocked page', {skipped: [{url: mkUrl('/x'), reason: 'blocked-by-robots'}]}, /not read/],
  ])(
    'is not applicable, naming the reason, when the crawl was cut by %s',
    (_name, over, reason) => {
      const product = run([audited('/a'), page('/')], {
        stats: {truncatedByBudget: false, overPageCap: false, cutByDepth: false, ...over.stats},
        ...over,
      });
      expect(product.notApplicable).toBe(true);
      expect(product.explanation).toMatch(reason);
      expect(product.explanation).toMatch(/LHCI_SEO_CRAWL_MAX_PAGES/);
    }
  );

  it('is not applicable when the audited page is the homepage', () => {
    expect(run([audited('/'), page('/a')]).notApplicable).toBe(true);
  });

  it('lists other orphans, how the crawl found them, without failing on them', () => {
    const product = run([
      audited('/a', {links: ['/']}),
      page('/', {links: ['/a']}),
      page('/o1', {source: 'sitemap'}),
      page('/o2', {source: 'sitemap'}),
    ]);
    expect(product.score).toBe(1);
    expect(product.details.items).toHaveLength(2);
    expect(product.details.items[0].found).toBe('the sitemap');
  });

  it('mentions the other orphans in a failing explanation', () => {
    const product = run([
      audited('/a'),
      page('/', {links: ['/b']}),
      page('/b'),
      page('/o', {source: 'sitemap'}),
    ]);
    expect(product.explanation).toMatch(/1 other crawled page is also orphaned/);
  });
});

describe('crawl-depth', () => {
  const run = (/** @type {any[]} */ pages, over = {}) =>
    // @ts-expect-error - partial test artifact
    buildCrawlDepthProduct(artifact(pages, over));
  /** A chain /, /d1, /d2, ... with the audited page being the nth. */
  const chain = (/** @type {number} */ n) => {
    const pages = [];
    for (let i = 0; i <= n; i++) {
      const path = i === 0 ? '/' : `/d${i}`;
      const over = {links: i < n ? [`/d${i + 1}`] : []};
      pages.push(i === n ? audited(path, over) : page(path, over));
    }
    return pages;
  };

  it('passes at the limit and says how many clicks', () => {
    const product = run(chain(MAX_DEPTH));
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('3 clicks from the homepage');
  });

  it('fails one click past the limit on a complete crawl, listing nothing it cannot back up', () => {
    const product = run(chain(MAX_DEPTH + 1));
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('4 clicks from the homepage');
    expect(product.explanation).toMatch(/deeper than the 3 this audit allows/);
  });

  it('is not applicable past the limit when the crawl was partial, because a shorter path may exist', () => {
    const product = run(chain(MAX_DEPTH + 1), partial);
    expect(product.notApplicable).toBe(true);
    expect(product.explanation).toMatch(/a shorter path may exist/);
  });

  it('still passes within the limit on a partial crawl: a shorter path only makes it smaller', () => {
    expect(run(chain(2), partial).score).toBe(1);
  });

  it('measures the shortest path, not the first one found', () => {
    const product = run([
      page('/', {links: ['/a', '/shortcut']}),
      page('/a', {links: ['/b']}),
      page('/b', {links: ['/c']}),
      page('/shortcut', {links: ['/c']}),
      audited('/c'),
    ]);
    expect(product.displayValue).toBe('2 clicks from the homepage');
  });

  it('calls the homepage the homepage', () => {
    const product = run([audited('/', {links: ['/a']}), page('/a')]);
    expect(product.displayValue).toBe('The homepage');
    expect(product.score).toBe(1);
  });

  it('is not applicable when the homepage was not read, or when no path from it leads to the audited page', () => {
    expect(run([audited('/a'), page('/', {extraction: 'error'})]).notApplicable).toBe(true);
    const unreachable = run([audited('/a'), page('/', {links: ['/b']}), page('/b')]);
    expect(unreachable.notApplicable).toBe(true);
    expect(unreachable.explanation).toMatch(/orphan-pages/);
    const cut = run([audited('/a'), page('/', {links: ['/b']}), page('/b')], partial);
    expect(cut.notApplicable).toBe(true);
    expect(cut.explanation).toMatch(/page cap.*one may exist/);
    expect(cut.explanation).not.toMatch(/orphan-pages/);
  });

  it('lists other deep pages only when the crawl was complete', () => {
    const deep = [...chain(MAX_DEPTH + 1)];
    deep.push(page('/d5', {}));
    deep[deep.length - 2].links.push({url: mkUrl('/d5'), nofollow: false, anchor: ''});
    const complete = run(deep);
    expect(complete.explanation).toMatch(/1 other crawled page is also deeper/);
    const withOthers = run([...deep]);
    expect(withOthers.details.items).toHaveLength(2);
  });
});
