/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The internal link graph of a crawl snapshot, for the Phase 8 audits (`dead-end-pages`, `internal-link-counts`,
 * `orphan-pages`, `crawl-depth`). Pure: no I/O, never throws, linear in the number of links.
 *
 * Nodes are the crawled pages, one per final URL (two requested URLs that end on one page are one node). An
 * edge is an internal link from a page read as HTML to another crawled page; a link to the page itself, to a
 * URL the crawl never requested, or marked `nofollow` is not an edge (a nofollow link does not pass the
 * crawl on, so it does not make a page reachable). Everything here is a statement about the pages the crawl
 * *saw*: `crawlCompleteness` says whether that was the whole site, and the audits that would be wrong on a
 * partial crawl (inbound links, orphans) use it.
 */

import {normalizeUrl} from './crawl-snapshot.js';

/** @typedef {import('./crawl-snapshot.js').CrawlSnapshot} CrawlSnapshot */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/**
 * `out` and `in` are edges between crawled pages; `targets` is every distinct page the page links to with a followable
 * link, crawled or not, other than itself (a crawled one by its key, any other by its normalised URL).
 * @typedef {{key: string, page: CrawlPage, out: Set<string>, in: Set<string>, targets: Set<string>}} GraphNode
 */
/** @typedef {{nodes: Map<string, GraphNode>, resolve: (url: string) => GraphNode | null}} LinkGraph */

// Why a URL on the site was not read, which means links from it (to the audited page, say) are unknown.
const UNREAD_REASONS = new Set([
  'blocked-by-robots',
  'query-variants',
  'over-page-cap',
  'not-checked',
  'failed',
]);

/**
 * @param {CrawlPage} page
 * @return {string}
 */
function keyOf(page) {
  return normalizeUrl(page.finalUrl || page.url) || page.finalUrl || page.url;
}

/**
 * @param {CrawlSnapshot} snapshot
 * @return {LinkGraph}
 */
function buildGraph(snapshot) {
  /** @type {Map<string, GraphNode>} */
  const nodes = new Map();
  /** @type {Map<string, GraphNode>} */
  const byRequested = new Map();
  for (const page of snapshot.pages) {
    const key = keyOf(page);
    let node = nodes.get(key);
    if (!node) {
      node = {key, page, out: new Set(), in: new Set(), targets: new Set()};
      nodes.set(key, node);
    } else if (node.page.extraction !== 'ok' && page.extraction === 'ok') {
      node.page = page;
    }
    const requested = normalizeUrl(page.url);
    if (requested && !byRequested.has(requested)) byRequested.set(requested, node);
  }
  /** @param {string} url @return {GraphNode | null} */
  const resolve = url => {
    // The crawler stores normalised URLs, so the direct lookup nearly always hits; normalising is the fallback.
    const direct = nodes.get(url) || byRequested.get(url);
    if (direct) return direct;
    const normal = normalizeUrl(url);
    if (!normal) return null;
    return nodes.get(normal) || byRequested.get(normal) || null;
  };
  for (const node of nodes.values()) {
    if (node.page.extraction !== 'ok') continue;
    for (const link of node.page.links) {
      if (link.nofollow) continue;
      const target = resolve(link.url);
      if (target === node) continue;
      if (!target) {
        const url = normalizeUrl(link.url);
        if (url) node.targets.add(url);
        continue;
      }
      node.targets.add(target.key);
      node.out.add(target.key);
      target.in.add(node.key);
    }
  }
  return {nodes, resolve};
}

/**
 * Whether the crawl saw the whole site, so that "nothing links here" can be believed.
 * @param {CrawlSnapshot} snapshot
 * @return {{complete: boolean, reasons: string[]}}
 */
function crawlCompleteness(snapshot) {
  /** @type {string[]} */
  const reasons = [];
  if (snapshot.robots.state === 'unavailable') {
    reasons.push('robots.txt could not be read, so only the audited page was requested');
  }
  if (snapshot.stats.overPageCap) reasons.push('more pages were found than the page cap');
  if (snapshot.stats.cutByDepth) reasons.push('links were not followed past the depth bound');
  if (snapshot.stats.truncatedByBudget) reasons.push('the time budget ran out');
  if (snapshot.skipped.some(skip => UNREAD_REASONS.has(skip.reason))) {
    reasons.push(
      'some pages were not read (blocked by robots.txt, a query-string trap, or failed)'
    );
  }
  if (snapshot.pages.some(page => page.extraction === 'error' || page.truncated)) {
    reasons.push('some pages could not be read in full');
  }
  return {complete: reasons.length === 0, reasons};
}

/**
 * Click depth from the homepage over the followable links the crawl saw: the length of the shortest path.
 * It can only be an over-estimate on a partial crawl (a shorter path may run through a page not crawled).
 * @param {LinkGraph} graph
 * @param {string} homeKey
 * @return {Map<string, number>} Depth per reachable node, the homepage 0.
 */
function clickDepths(graph, homeKey) {
  /** @type {Map<string, number>} */
  const depth = new Map([[homeKey, 0]]);
  const queue = [homeKey];
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i];
    const node = graph.nodes.get(key);
    if (!node) continue;
    for (const next of node.out) {
      if (depth.has(next)) continue;
      depth.set(next, /** @type {number} */ (depth.get(key)) + 1);
      queue.push(next);
    }
  }
  return depth;
}

/**
 * @param {CrawlSnapshot} snapshot
 * @param {LinkGraph} graph
 * @return {GraphNode | null} The homepage node, only when the homepage was read as HTML.
 */
function homeNode(snapshot, graph) {
  const home = graph.resolve(`${snapshot.origin}/`);
  return home && home.page.extraction === 'ok' ? home : null;
}

export {buildGraph, crawlCompleteness, clickDepths, homeNode, keyOf};
