/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildAnchorDiversityProduct,
  buildDescriptiveAnchorsProduct,
  normalizeAnchor,
  MAX_ROWS,
} = require('../../src/lib/crawl-anchors.js');

const O = 'https://example.com';
const mkUrl = (/** @type {string} */ p) => `${O}${p}`;
const link = (/** @type {string} */ to, /** @type {string} */ anchor, nofollow = false) => ({
  url: mkUrl(to),
  anchor,
  nofollow,
});
/** @param {string} path @param {any[]} [links] @param {any} [over] */
const page = (path, links = [], over = {}) => ({
  url: mkUrl(path),
  finalUrl: mkUrl(path),
  status: 200,
  redirects: [],
  truncated: false,
  extraction: 'ok',
  source: 'link',
  links,
  ...over,
});
/** @param {string} path @param {any[]} [links] @param {any} [over] */
const audited = (path, links = [], over = {}) => page(path, links, {source: 'audited', ...over});
/** @param {any[]} pages @param {any} [extra] */
const artifact = (pages, extra = {}) => ({
  state: 'crawled',
  auditedUrl: pages[0].url,
  reason: null,
  auditedRenderedTextLength: null,
  linkChecks: null,
  snapshot: {
    origin: O,
    robots: {state: 'present'},
    pages,
    skipped: [],
    stats: {truncatedByBudget: false, overPageCap: false, cutByDepth: false},
  },
  ...extra,
});
/** A site of `n` filler pages plus the given ones, so the navigation threshold is not tiny. */
const filler = (/** @type {number} */ n) => Array.from({length: n}, (_, i) => page(`/f${i}`));
/** `count` pages that each link to /t with the given anchors. */
const linkers = (/** @type {string[]} */ anchors, to = '/t') =>
  anchors.map((anchor, i) => page(`/s${to.replace(/\W/g, '')}${i}`, [link(to, anchor)]));

describe('normalizeAnchor', () => {
  it('lower-cases, drops punctuation and symbols, and collapses spaces', () => {
    expect(normalizeAnchor('  Red   Shoes! ')).toBe('red shoes');
    expect(normalizeAnchor('Read more »')).toBe('read more');
    expect(normalizeAnchor('Café — Menü')).toBe('café menü');
    expect(normalizeAnchor('…')).toBe('');
    expect(normalizeAnchor('')).toBe('');
    expect(normalizeAnchor(/** @type {any} */ (null))).toBe('');
  });
});

describe.each([
  ['anchor-text-diversity', buildAnchorDiversityProduct],
  ['descriptive-anchor-text', buildDescriptiveAnchorsProduct],
])('%s: cases shared by both audits', (_name, build) => {
  it.each([null, undefined, {}, 5, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(build(input).notApplicable).toBe(true);
    }
  );

  it('is not applicable when the audited page was not read, or looks script-built', () => {
    // @ts-expect-error - partial test artifact
    expect(
      build(artifact([audited('/t', [], {extraction: 'error'}), page('/')])).notApplicable
    ).toBe(true);
    const product = build(
      // @ts-expect-error - partial test artifact
      artifact([audited('/t', [], {textLength: 5, wordCount: 1}), page('/')], {
        auditedRenderedTextLength: 5000,
      })
    );
    expect(product.notApplicable).toBe(true);
    expect(product.explanation).toMatch(/cannot be read from server HTML/);
  });
});

describe('anchor-text-diversity', () => {
  const run = (/** @type {any[]} */ pages, extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildAnchorDiversityProduct(artifact(pages, extra));
  const withTarget = (/** @type {any[]} */ extra) => [audited('/t'), ...extra, ...filler(8)];

  it('fails when one anchor is most of five or more editorial links', () => {
    const product = run(
      withTarget(linkers(['red shoes', 'red shoes', 'red shoes', 'shoes', 'our range']))
    );
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('Top anchor "red shoes" is 60% of 5 links');
    expect(product.explanation).toMatch(/60% of the 5 editorial internal links.*"red shoes"/);
    expect(product.details.items[0]).toMatchObject({anchor: 'red shoes', links: 3, share: '60%'});
  });

  it('passes just under the share and at a varied distribution', () => {
    expect(run(withTarget(linkers(['a b', 'a b', 'c d', 'e f', 'g h']))).score).toBe(1);
    expect(
      run(withTarget(linkers(['red shoes', 'blue shoes', 'our shoes', 'shoes', 'footwear']))).score
    ).toBe(1);
  });

  it('does not judge fewer than five links, and says so', () => {
    const product = run(withTarget(linkers(['same', 'same', 'same', 'same'])));
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('4 editorial internal links: too few to judge');
  });

  it('compares anchors without case or punctuation differences', () => {
    const product = run(
      withTarget(linkers(['Red Shoes!', 'red shoes', 'RED  SHOES', 'x y', 'z w']))
    );
    expect(product.score).toBe(0);
  });

  it('leaves out site-wide navigation, which would otherwise make every menu item over-repeated', () => {
    const pages = [audited('/t'), ...filler(10)];
    // The menu link "Shop" to /t is on 10 of the 11 other pages (11 of 12 pages): navigation.
    for (let i = 0; i < 10; i++) pages[i + 1].links.push(link('/t', 'Shop'));
    const product = run(pages);
    expect(product.score).toBe(1);
    expect(product.displayValue).toMatch(
      /0 editorial internal links: too few to judge \(10 site-wide navigation links left out\)/
    );
  });

  it('does not mistake an over-repeated anchor on half the site for navigation', () => {
    const pages = [audited('/t'), ...filler(10)];
    for (let i = 0; i < 7; i++) pages[i + 1].links.push(link('/t', 'red running shoes'));
    const product = run(pages);
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('Top anchor "red running shoes" is 100% of 7 links');
  });

  it('does not count empty anchors, links from the page to itself, or nofollow-free filtering', () => {
    const pages = withTarget(linkers(['', '', 'x y', 'z w', 'q r', 'v u']));
    pages[0].links.push(link('/t', 'self link'));
    const product = run(pages);
    expect(product.score).toBe(1);
    expect(product.displayValue).toMatch(/2 links with no anchor text left out/);
  });

  it('counts a link through a redirected URL as a link to the page', () => {
    const redirected = page('/old', [], {finalUrl: mkUrl('/t')});
    const sources = [0, 1, 2, 3, 4].map(i => page(`/r${i}`, [link('/old', 'red shoes')]));
    const product = run([audited('/t'), redirected, ...sources, ...filler(8)]);
    expect(product.score).toBe(0);
  });

  it('is not applicable for the homepage', () => {
    const pages = [audited('/', []), ...linkers(Array(6).fill('home'), '/'), ...filler(6)];
    expect(run(pages).notApplicable).toBe(true);
  });

  it('lists other pages with the same pattern without failing on them', () => {
    const pages = [
      audited('/t', []),
      ...linkers(['a b', 'c d', 'e f', 'g h', 'i j']),
      ...linkers(Array(6).fill('cheap widgets'), '/w'),
      page('/w'),
      ...filler(8),
    ];
    const product = run(pages);
    expect(product.score).toBe(1);
    const other = product.details.items.find((/** @type {any} */ i) =>
      /other crawled page/.test(i.note)
    );
    expect(other).toMatchObject({page: mkUrl('/w'), anchor: 'cheap widgets', share: '100%'});
  });

  it('caps the other-pages rows', () => {
    const pages = [audited('/t'), ...filler(10)];
    for (let i = 0; i < 70; i++) {
      pages.push(page(`/w${i}`), ...linkers(Array(5).fill('same words'), `/w${i}`));
    }
    const product = run(pages);
    expect(product.details.items.length).toBeLessThanOrEqual(MAX_ROWS + 2);
    expect(JSON.stringify(product.details.items)).toMatch(/more not shown/);
  });
});

describe('descriptive-anchor-text', () => {
  const run = (/** @type {any[]} */ pages, extra = {}) =>
    // @ts-expect-error - partial test artifact
    buildDescriptiveAnchorsProduct(artifact(pages, extra));

  it('passes a page whose links all describe their target', () => {
    const product = run([
      audited('/t', [link('/a', 'Our red shoes'), link('/b', 'Contact the team')]),
      page('/a'),
      page('/b'),
    ]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('Every internal link on the page describes its target');
  });

  it.each([
    'click here',
    'Click here!',
    'READ MORE',
    'Read more »',
    'here',
    'Learn more',
    'this link',
  ])('fails the generic anchor %j', anchor => {
    const product = run([audited('/t', [link('/a', anchor)]), page('/a')]);
    expect(product.score).toBe(0);
    expect(product.details.items[0]).toMatchObject({problem: 'generic anchor text', anchor});
  });

  it('fails a link with no anchor text, and counts both kinds, nofollow links included', () => {
    const product = run([
      audited('/t', [
        link('/a', ''),
        link('/b', 'more'),
        link('/c', 'Cart', true),
        link('/d', 'learn more', true),
      ]),
      page('/a'),
    ]);
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('3 links with generic or empty anchor text');
    expect(product.details.items.map((/** @type {any} */ i) => i.problem)).toEqual([
      'no anchor text',
      'generic anchor text',
      'generic anchor text',
    ]);
  });

  it('does not treat a descriptive phrase that contains a generic word as generic', () => {
    const product = run([
      audited('/t', [
        link('/a', 'Read more about our returns policy'),
        link('/b', 'Click here to download the 2026 guide'),
      ]),
    ]);
    expect(product.score).toBe(1);
  });

  it('uses singular wording for one link', () => {
    expect(run([audited('/t', [link('/a', 'here')])]).explanation).toMatch(
      /1 internal link on the audited page says nothing about where it goes/
    );
  });

  it('lists other pages with weak anchors without failing on them', () => {
    const product = run([
      audited('/t', [link('/a', 'Shoes')]),
      page('/a', [link('/t', 'click here'), link('/t', 'more')]),
    ]);
    expect(product.score).toBe(1);
    expect(product.details.items[0].problem).toMatch(
      /other crawled page: 2 links with generic or empty anchor text/
    );
  });

  it('mentions the other pages in a failing explanation', () => {
    const product = run([audited('/t', [link('/a', 'here')]), page('/a', [link('/t', 'more')])]);
    expect(product.explanation).toMatch(
      /1 other crawled page also has some \(listed, not judged\)/
    );
  });

  it('caps the rows', () => {
    const links = Array.from({length: 90}, (_, i) => link(`/p${i}`, 'click here'));
    const product = run([audited('/t', links)]);
    expect(product.details.items).toHaveLength(MAX_ROWS + 1);
    expect(product.details.items[MAX_ROWS].page).toBe('40 more not shown');
  });
});
