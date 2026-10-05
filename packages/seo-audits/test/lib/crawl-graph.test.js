/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildGraph,
  crawlCompleteness,
  clickDepths,
  homeNode,
} = require('../../src/lib/crawl-graph.js');

const O = 'https://example.com';
const mkUrl = (/** @type {string} */ p) => `${O}${p}`;
/** @param {string} url @param {any} [over] */
const page = (url, over = {}) => {
  const built = {
    url,
    finalUrl: url,
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
/** @param {any[]} pages @param {any} [over] */
const snapshot = (pages, over = {}) => ({
  origin: O,
  robots: {state: 'present'},
  pages,
  skipped: [],
  stats: {truncatedByBudget: false, overPageCap: false, cutByDepth: false},
  ...over,
});
// @ts-expect-error - partial test snapshots
const graphOf = (/** @type {any[]} */ pages) => buildGraph(snapshot(pages));

describe('buildGraph', () => {
  it('makes an edge for each followable internal link between crawled pages', () => {
    const g = graphOf([
      page(mkUrl('/'), {links: ['/a', '/b']}),
      page(mkUrl('/a'), {links: ['/b']}),
      page(mkUrl('/b')),
    ]);
    expect([...(g.nodes.get(mkUrl('/'))?.out || [])]).toEqual([mkUrl('/a'), mkUrl('/b')]);
    expect([...(g.nodes.get(mkUrl('/b'))?.in || [])].sort()).toEqual([mkUrl('/'), mkUrl('/a')]);
  });

  it('ignores nofollow links, links to the page itself and links to pages that were not crawled', () => {
    const g = graphOf([
      page(mkUrl('/'), {
        links: [{url: mkUrl('/a'), nofollow: true, anchor: ''}, '/', '/never-crawled'],
      }),
      page(mkUrl('/a')),
    ]);
    expect(g.nodes.get(mkUrl('/'))?.out.size).toBe(0);
    expect(g.nodes.get(mkUrl('/a'))?.in.size).toBe(0);
    // A link to a page the crawl never reached is still a target of the page, but not an edge.
    expect([...(g.nodes.get(mkUrl('/'))?.targets || [])]).toEqual([mkUrl('/never-crawled')]);
  });

  it('makes no edges from a page that was not read as HTML', () => {
    const g = graphOf([page(mkUrl('/'), {extraction: 'error', links: ['/a']}), page(mkUrl('/a'))]);
    expect(g.nodes.get(mkUrl('/a'))?.in.size).toBe(0);
  });

  it('treats two requested URLs that end on one page as one node, and resolves links to either', () => {
    const g = graphOf([
      page(mkUrl('/'), {links: ['/old']}),
      page(mkUrl('/old'), {finalUrl: mkUrl('/new')}),
      page(mkUrl('/new')),
    ]);
    expect(g.nodes.size).toBe(2);
    expect(g.nodes.get(mkUrl('/new'))?.in.has(mkUrl('/'))).toBe(true);
    expect(g.resolve(mkUrl('/old'))).toBe(g.resolve(mkUrl('/new')));
    expect(g.resolve('not a url')).toBeNull();
    expect(g.resolve(mkUrl('/unknown'))).toBeNull();
  });
});

describe('clickDepths and homeNode', () => {
  const pages = [
    page(mkUrl('/'), {links: ['/a', '/b']}),
    page(mkUrl('/a'), {links: ['/c']}),
    page(mkUrl('/b'), {links: ['/c', '/d']}),
    page(mkUrl('/c'), {links: ['/']}),
    page(mkUrl('/d')),
    page(mkUrl('/island')),
  ];

  it('is the length of the shortest path of followable links from the homepage', () => {
    const g = graphOf(pages);
    const depths = clickDepths(g, mkUrl('/'));
    expect(Object.fromEntries(depths)).toEqual({
      [mkUrl('/')]: 0,
      [mkUrl('/a')]: 1,
      [mkUrl('/b')]: 1,
      [mkUrl('/c')]: 2,
      [mkUrl('/d')]: 2,
    });
    expect(depths.has(mkUrl('/island'))).toBe(false);
  });

  it('finds the homepage only when it was read as HTML', () => {
    // @ts-expect-error - partial test snapshots
    const ok = homeNode(snapshot(pages), graphOf(pages));
    expect(ok?.key).toBe(mkUrl('/'));
    const bad = [page(mkUrl('/'), {extraction: 'error'})];
    // @ts-expect-error - partial test snapshots
    expect(homeNode(snapshot(bad), graphOf(bad))).toBeNull();
    // @ts-expect-error - partial test snapshots
    expect(homeNode(snapshot([page(mkUrl('/a'))]), graphOf([page(mkUrl('/a'))]))).toBeNull();
  });

  it('terminates on a cycle', () => {
    const g = graphOf([page(mkUrl('/'), {links: ['/a']}), page(mkUrl('/a'), {links: ['/']})]);
    expect(clickDepths(g, mkUrl('/')).size).toBe(2);
  });
});

describe('crawlCompleteness', () => {
  /** @param {any} over */
  const check = over => crawlCompleteness(/** @type {any} */ (snapshot([page(mkUrl('/'))], over)));

  it('is complete when nothing cut or hid any page', () => {
    expect(check({})).toEqual({complete: true, reasons: []});
  });

  it.each([
    ['the page cap', {stats: {overPageCap: true}}, /page cap/],
    ['the depth bound', {stats: {cutByDepth: true}}, /depth bound/],
    ['the time budget', {stats: {truncatedByBudget: true}}, /time budget/],
    ['unreadable robots.txt', {robots: {state: 'unavailable'}}, /robots\.txt could not be read/],
    ['a blocked page', {skipped: [{url: mkUrl('/x'), reason: 'blocked-by-robots'}]}, /not read/],
    ['a query-string trap', {skipped: [{url: mkUrl('/x'), reason: 'query-variants'}]}, /not read/],
    ['a failed page', {skipped: [{url: mkUrl('/x'), reason: 'failed'}]}, /not read/],
  ])('is partial because of %s', (_name, over, reason) => {
    const result = check({
      stats: {truncatedByBudget: false, overPageCap: false, cutByDepth: false, ...over.stats},
      ...over,
    });
    expect(result.complete).toBe(false);
    expect(result.reasons.join(' ')).toMatch(reason);
  });

  it('is partial when a page could not be read in full, but not for files or other origins', () => {
    expect(
      crawlCompleteness(/** @type {any} */ (snapshot([page(mkUrl('/'), {truncated: true})])))
        .complete
    ).toBe(false);
    expect(
      crawlCompleteness(/** @type {any} */ (snapshot([page(mkUrl('/'), {extraction: 'error'})])))
        .complete
    ).toBe(false);
    expect(
      check({
        skipped: [
          {url: mkUrl('/a.png'), reason: 'not-a-page'},
          {url: 'https://other.test/', reason: 'cross-origin'},
        ],
      }).complete
    ).toBe(true);
  });
});
