/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builders for the anchor-text audits: `anchor-text-diversity` (one exact anchor making up most of
 * the internal links to a page) and `descriptive-anchor-text` (links whose anchor says nothing: "click here",
 * "read more", or no text at all). They read the site crawl's snapshot only. No I/O, never throws.
 *
 * Rules, chosen with the developer:
 *   - over-repeated: one anchor is at least `MIN_SHARE` of at least `MIN_LINKS` internal links to the page;
 *   - a link that appears with the same anchor on at least four fifths of the crawled pages (and at least three) is
 *     site-wide navigation (a menu, a footer), not editorial linking, and is left out of the diversity count
 *     (otherwise every menu item would "over-use" its own name). The line is high on purpose: an anchor repeated on
 *     half the site is exactly the pattern this audit is for;
 *   - each audit judges the audited page and lists other crawled pages without failing on them.
 * Anchor text is compared after lower-casing and dropping punctuation. It comes from server HTML (text, then image
 * alt, then aria-label or title), so a page built by script is not applicable.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildGraph, homeNode} from './crawl-graph.js';
import {scriptBuiltContent} from './crawl-coverage.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-graph.js').GraphNode} GraphNode */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MIN_LINKS = 5;
const MIN_SHARE = 0.6;
const NAV_MIN_PAGES = 3;
const NAV_PAGE_SHARE = 0.8;
const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const MAX_TOP_ANCHORS = 5;
const GENERIC = new Set([
  'click here',
  'click',
  'here',
  'this',
  'this link',
  'link',
  'read more',
  'read on',
  'more',
  'learn more',
  'see more',
  'view more',
  'more info',
  'more information',
  'details',
  'continue',
  'continue reading',
  'go',
]);

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * @param {number} n
 * @param {string} noun
 * @return {string}
 */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * @param {string} text
 * @return {string} The anchor in comparable form: lower-case, punctuation and symbols dropped, spaces collapsed.
 */
function normalizeAnchor(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {{product: Product} | {
 *   snapshot: import('./crawl-snapshot.js').CrawlSnapshot, graph: import('./crawl-graph.js').LinkGraph,
 *   audited: GraphNode, readable: GraphNode[],
 * }}
 */
function prepare(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return {product: notApplicable('The site crawl was not collected.')};
  }
  if (artifact.state === 'disabled' || artifact.state === 'unavailable') {
    return {product: notApplicable(artifact.reason || 'The site crawl did not run.')};
  }
  const snapshot = artifact.snapshot;
  if (!snapshot || !Array.isArray(snapshot.pages)) {
    return {product: notApplicable('The site crawl could not run.')};
  }
  const graph = buildGraph(snapshot);
  const page = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  const audited = page && graph.resolve(page.finalUrl || page.url);
  if (!page || !audited) {
    return {
      product: notApplicable(
        'The crawler did not receive the audited page as HTML, so its links were not read.'
      ),
    };
  }
  const script = scriptBuiltContent(artifact);
  if (script) {
    return {
      product: notApplicable(
        `The audited page shows ${script.rendered} characters of text in a browser but only ${script.server} in the HTML the crawler received, so anchor text cannot be read from server HTML.`
      ),
    };
  }
  const readable = [...graph.nodes.values()].filter(node => node.page.extraction === 'ok');
  return {snapshot, graph, audited, readable};
}

/**
 * Every internal link to each crawled page, with its normalised anchor and the page it is on, leaving out the
 * page's own links and site-wide navigation.
 * @param {import('./crawl-graph.js').LinkGraph} graph
 * @param {GraphNode[]} readable
 * @return {Map<string, {anchors: string[], empty: number, navigation: number}>} By target page.
 */
function inboundAnchors(graph, readable) {
  /** @type {Array<{target: string, source: string, anchor: string}>} */
  const all = [];
  /** @type {Map<string, Set<string>>} */
  const sourcesOf = new Map();
  for (const node of readable) {
    for (const link of node.page.links) {
      const target = graph.resolve(link.url);
      if (!target || target === node) continue;
      const anchor = normalizeAnchor(link.anchor);
      all.push({target: target.key, source: node.key, anchor});
      const key = `${target.key}\n${anchor}`;
      const set = sourcesOf.get(key) || new Set();
      set.add(node.key);
      sourcesOf.set(key, set);
    }
  }
  const navMin = Math.max(NAV_MIN_PAGES, Math.ceil(readable.length * NAV_PAGE_SHARE));
  /** @type {Map<string, {anchors: string[], empty: number, navigation: number}>} */
  const byTarget = new Map();
  for (const {target, anchor} of all) {
    const entry = byTarget.get(target) || {anchors: [], empty: 0, navigation: 0};
    byTarget.set(target, entry);
    if (!anchor) entry.empty++;
    else if ((sourcesOf.get(`${target}\n${anchor}`) || new Set()).size >= navMin) {
      entry.navigation++;
    } else entry.anchors.push(anchor);
  }
  return byTarget;
}

/**
 * @param {string[]} anchors
 * @return {{total: number, top: Array<{anchor: string, count: number, share: number}>}}
 */
function distribution(anchors) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const anchor of anchors) counts.set(anchor, (counts.get(anchor) || 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([anchor, n]) => ({anchor, count: n, share: n / anchors.length}));
  return {total: anchors.length, top};
}

/**
 * @param {number} share
 * @return {string}
 */
function percent(share) {
  return `${Math.round(share * 100)}%`;
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildAnchorDiversityProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {snapshot, graph, audited, readable} = prep;
  if (homeNode(snapshot, graph) === audited) {
    return notApplicable(
      'The audited page is the homepage, which nearly every page links to with the same menu or logo anchor.'
    );
  }
  const inbound = inboundAnchors(graph, readable);
  const mine = inbound.get(audited.key) || {anchors: [], empty: 0, navigation: 0};
  const dist = distribution(mine.anchors);
  const over = dist.total >= MIN_LINKS && dist.top[0].share >= MIN_SHARE;

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page'},
    {key: 'anchor', valueType: 'text', label: 'Most-used anchor text'},
    {key: 'links', valueType: 'text', label: 'Links with it'},
    {key: 'share', valueType: 'text', label: 'Share'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  /** @type {Array<Record<string, string | number>>} */
  const rows = dist.top.slice(0, MAX_TOP_ANCHORS).map((entry, i) => ({
    page: i === 0 ? clip(audited.key) : '',
    anchor: clip(entry.anchor),
    links: entry.count,
    share: percent(entry.share),
    note: i === 0 ? `the audited page: ${count(dist.total, 'editorial internal link')}` : '',
  }));
  /** @type {Array<Record<string, string | number>>} */
  const others = [];
  for (const node of readable) {
    if (node === audited) continue;
    const other = distribution((inbound.get(node.key) || {anchors: []}).anchors);
    if (other.total >= MIN_LINKS && other.top[0].share >= MIN_SHARE) {
      others.push({
        page: clip(node.key),
        anchor: clip(other.top[0].anchor),
        links: other.top[0].count,
        share: percent(other.top[0].share),
        note: `other crawled page: ${count(other.total, 'editorial internal link')}`,
      });
    }
  }
  const items = [...rows, ...others.slice(0, MAX_ROWS)];
  if (others.length > MAX_ROWS) {
    items.push({
      page: `${others.length - MAX_ROWS} more not shown`,
      anchor: '',
      links: '',
      share: '',
      note: '',
    });
  }
  const left = [
    mine.navigation ? `${count(mine.navigation, 'site-wide navigation link')} left out` : '',
    mine.empty ? `${count(mine.empty, 'link')} with no anchor text left out` : '',
  ].filter(Boolean);
  const aside = left.length ? ` (${left.join('; ')})` : '';
  if (dist.total < MIN_LINKS) {
    return {
      score: 1,
      displayValue: `${count(dist.total, 'editorial internal link')}: too few to judge${aside}`,
      details: Audit.makeTableDetails(headings, items),
    };
  }
  return {
    score: over ? 0 : 1,
    displayValue: `Top anchor "${clip(dist.top[0].anchor)}" is ${percent(
      dist.top[0].share
    )} of ${count(dist.total, 'link')}`,
    explanation: over
      ? `${percent(dist.top[0].share)} of the ${count(
          dist.total,
          'editorial internal link'
        )} to the audited page use the anchor "${clip(
          dist.top[0].anchor
        )}"${aside}. Repeating one exact phrase looks manufactured and wastes the chance to describe the page in different words: vary the anchors.${
          others.length
            ? ` ${count(others.length, 'other crawled page')} ${
                others.length === 1 ? 'shows' : 'show'
              } the same pattern (listed, not judged).`
            : ''
        } Counted among the crawled pages only.`
      : undefined,
    details: Audit.makeTableDetails(headings, items),
  };
}

/**
 * @param {GraphNode} node
 * @return {Array<{url: string, anchor: string, problem: string}>}
 */
function weakAnchors(node) {
  /** @type {Array<{url: string, anchor: string, problem: string}>} */
  const found = [];
  for (const link of node.page.links) {
    const normal = normalizeAnchor(link.anchor);
    if (!normal) found.push({url: link.url, anchor: '', problem: 'no anchor text'});
    else if (GENERIC.has(normal)) {
      found.push({url: link.url, anchor: link.anchor, problem: 'generic anchor text'});
    }
  }
  return found;
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildDescriptiveAnchorsProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {audited, readable} = prep;
  const mine = weakAnchors(audited);
  /** @type {Array<{node: GraphNode, found: ReturnType<typeof weakAnchors>}>} */
  const others = [];
  for (const node of readable) {
    if (node === audited) continue;
    const found = weakAnchors(node);
    if (found.length) others.push({node, found});
  }
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page'},
    {key: 'target', valueType: 'text', label: 'Links to'},
    {key: 'anchor', valueType: 'text', label: 'Anchor text'},
    {key: 'problem', valueType: 'text', label: 'Problem'},
  ];
  /** @type {Array<Record<string, string>>} */
  const rows = mine.slice(0, MAX_ROWS).map(w => ({
    page: clip(audited.key),
    target: clip(w.url),
    anchor: w.anchor,
    problem: w.problem,
  }));
  for (const {node, found} of others.slice(0, Math.max(0, MAX_ROWS - rows.length))) {
    rows.push({
      page: clip(node.key),
      target: '',
      anchor: '',
      problem: `other crawled page: ${count(
        found.length,
        'link'
      )} with generic or empty anchor text`,
    });
  }
  const hidden =
    mine.length -
    Math.min(mine.length, MAX_ROWS) +
    Math.max(0, others.length - Math.max(0, MAX_ROWS - mine.length));
  if (hidden > 0) {
    rows.push({page: `${hidden} more not shown`, target: '', anchor: '', problem: ''});
  }
  const otherNote = others.length
    ? ` ${count(others.length, 'other crawled page')} also ${
        others.length === 1 ? 'has' : 'have'
      } some (listed, not judged).`
    : '';
  return {
    // A warning (0.5): Google recommends descriptive anchors, but "read more" under a heading is common.
    score: mine.length ? 0.5 : 1,
    numericValue: mine.length,
    numericUnit: 'unitless',
    displayValue: mine.length
      ? `${count(mine.length, 'link')} with generic or empty anchor text`
      : 'Every internal link on the page describes its target',
    explanation: mine.length
      ? `${count(mine.length, 'internal link')} on the audited page ${
          mine.length === 1 ? 'says' : 'say'
        } nothing about where ${
          mine.length === 1 ? 'it goes' : 'they go'
        }: "click here", "read more" and similar, or no text at all (an image without alt text, an icon without a label). Use words that describe the target: they help visitors, screen readers and search engines.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(headings, rows),
  };
}

export {
  buildAnchorDiversityProduct,
  buildDescriptiveAnchorsProduct,
  normalizeAnchor,
  GENERIC,
  MIN_LINKS,
  MIN_SHARE,
  MAX_ROWS,
};
