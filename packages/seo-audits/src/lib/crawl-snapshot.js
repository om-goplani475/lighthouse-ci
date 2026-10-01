/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Types, constants and pure helpers for the site crawler's snapshot: no I/O, nothing that imports
 * `import.meta`, so every rule here is unit-testable. The crawler (`crawler.js`), the extractor
 * (`crawl-extract.js`) and the cache (`crawl-cache.js`) all build on this one definition of what a
 * snapshot is, so they cannot drift apart.
 *
 * A snapshot is what the crawl saw of a site, reduced to the fields the cross-page audits need (title,
 * description, canonicals, robots signals, a hash of the visible text, the page's internal links). Raw
 * HTML is never stored.
 */

import {createHash} from 'crypto';
import {pickEvenly} from './sitemap-url-sample.js';

/**
 * @typedef {{url: string, status: number, location: string | null}} CrawlHop
 * @typedef {{url: string, nofollow: boolean}} CrawlLink
 * @typedef {'ok' | 'skipped-not-html' | 'skipped-status' | 'error'} ExtractionState
 * @typedef {{
 *   url: string,
 *   finalUrl: string,
 *   redirects: CrawlHop[],
 *   status: number | null,
 *   contentType: string | null,
 *   bytes: number,
 *   truncated: boolean,
 *   title: string | null,
 *   description: string | null,
 *   canonicals: string[],
 *   robotsMetas: Array<{name: string, content: string}>,
 *   xRobotsTag: string[],
 *   h1: string[],
 *   textHash: string | null,
 *   textLength: number,
 *   wordCount: number,
 *   links: CrawlLink[],
 *   source: 'audited' | 'link' | 'sitemap',
 *   extraction: ExtractionState,
 * }} CrawlPage
 * @typedef {'blocked-by-robots' | 'cross-origin' | 'over-page-cap' | 'not-checked' | 'failed'} SkipReason
 * @typedef {{url: string, reason: SkipReason, detail: string | null}} CrawlSkip
 * @typedef {'present' | 'absent' | 'unavailable' | 'ignored'} CrawlRobotsState
 * @typedef {{
 *   version: 1,
 *   origin: string,
 *   createdAt: string,
 *   bounds: {pages: number, budgetMs: number, robots: 'honour' | 'ignore', userAgent: string},
 *   robots: {state: CrawlRobotsState},
 *   seeds: {audited: number, links: number, sitemap: number},
 *   pages: CrawlPage[],
 *   skipped: CrawlSkip[],
 *   stats: {requests: number, elapsedMs: number, truncatedByBudget: boolean},
 * }} CrawlSnapshot
 * @typedef {{
 *   state: 'crawled' | 'cached' | 'disabled' | 'unavailable',
 *   auditedUrl: string,
 *   reason: string | null,
 *   snapshot: CrawlSnapshot | null,
 *   auditedRenderedTextLength: number | null,
 * }} SiteCrawlArtifact
 */

const SNAPSHOT_VERSION = 1;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 1_000;
const MAX_LINKS_PER_PAGE = 200;
const MAX_H1 = 5;
const MAX_CANONICALS = 5;
const MAX_REDIRECT_ROUNDS = 3;
const REQUEST_CAP_FACTOR = 3;
const USER_AGENT = 'lhci-seo-audits-crawler/1.0';

const ROBOTS_MODES = ['honour', 'ignore'];
const ROBOTS_STATES = ['present', 'absent', 'unavailable', 'ignored'];
const EXTRACTION_STATES = ['ok', 'skipped-not-html', 'skipped-status', 'error'];

/**
 * A comparable form of a URL: lower-case scheme and host, default port dropped, dot segments resolved
 * and the fragment removed (all by the WHATWG URL parser); the query is kept exactly as written.
 * @param {string} href
 * @param {string} [base]
 * @return {string | null} Null for anything that is not a plain http(s) URL, including one that
 *   carries credentials (`user:pass@host`), which a crawler must never send.
 */
function normalizeUrl(href, base) {
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  url.hash = '';
  return url.href;
}

/**
 * @param {string} a
 * @param {string} b
 * @return {boolean} Whether both are valid URLs with the same scheme, host and port.
 */
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * @param {string[]} urls
 * @param {Set<string>} exclude
 * @return {string[]} The URLs in order, without duplicates or anything in `exclude`.
 */
function unique(urls, exclude) {
  const seen = new Set(exclude);
  /** @type {string[]} */
  const out = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Which URLs to request, in priority order. The audited page always comes first. The remaining slots
 * (`pages - 1`) are split: the page's own links get `ceil(slots / 2)`, the sitemap URLs the rest, each
 * chosen evenly and deterministically (the first and last are always kept), so the result is the same
 * on every run. When one list is shorter than its share the other takes the spare slots. A URL listed
 * by both counts as a link. Inputs must already be normalised and same-origin: filtering is the
 * caller's job, because it also has to record why a URL was dropped.
 * @param {{audited: string, links: string[], sitemapUrls: string[], pages: number}} input
 * @return {Array<{url: string, source: 'audited' | 'link' | 'sitemap'}>}
 */
function selectSeeds({audited, links, sitemapUrls, pages}) {
  /** @type {Array<{url: string, source: 'audited' | 'link' | 'sitemap'}>} */
  const seeds = [{url: audited, source: 'audited'}];
  const budget = Math.max(0, Math.floor(pages) - 1);
  if (budget === 0) return seeds;

  const linkPool = unique(links, new Set([audited]));
  const sitemapPool = unique(sitemapUrls, new Set([audited, ...linkPool]));

  let linkSlots = Math.ceil(budget / 2);
  let sitemapSlots = budget - linkSlots;
  if (linkPool.length < linkSlots) {
    sitemapSlots += linkSlots - linkPool.length;
    linkSlots = linkPool.length;
  }
  if (sitemapPool.length < sitemapSlots) {
    linkSlots = Math.min(linkPool.length, linkSlots + (sitemapSlots - sitemapPool.length));
    sitemapSlots = sitemapPool.length;
  }

  for (const url of linkSlots > 0 ? pickEvenly(linkPool, linkSlots) : []) {
    seeds.push({url, source: 'link'});
  }
  for (const url of sitemapSlots > 0 ? pickEvenly(sitemapPool, sitemapSlots) : []) {
    seeds.push({url, source: 'sitemap'});
  }
  return seeds;
}

/**
 * The cache file name for a crawl: every setting that changes what a crawl produces is part of the key,
 * so a different bound never reuses a stale snapshot.
 * @param {{origin: string, pages: number, robots: 'honour' | 'ignore', userAgent: string}} input
 * @return {string} A lower-case hex sha-256 (safe to use as a file name).
 */
function cacheKey({origin, pages, robots, userAgent}) {
  return createHash('sha256')
    .update(JSON.stringify([SNAPSHOT_VERSION, origin, pages, robots, userAgent]))
    .digest('hex');
}

/**
 * @param {unknown} value
 * @return {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @return {boolean}
 */
function isPage(value) {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.finalUrl === 'string' &&
    Array.isArray(value.redirects) &&
    (value.status === null || typeof value.status === 'number') &&
    typeof value.bytes === 'number' &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.canonicals) &&
    Array.isArray(value.robotsMetas) &&
    Array.isArray(value.xRobotsTag) &&
    Array.isArray(value.h1) &&
    (value.textHash === null || typeof value.textHash === 'string') &&
    typeof value.textLength === 'number' &&
    typeof value.wordCount === 'number' &&
    Array.isArray(value.links) &&
    typeof value.extraction === 'string' &&
    EXTRACTION_STATES.includes(value.extraction)
  );
}

/**
 * Whether a parsed value (read from the cache, so untrusted) has the snapshot's shape and version.
 * Structural, not exhaustive: the cache only ever holds what `crawlSite` wrote.
 * @param {unknown} value
 * @return {value is CrawlSnapshot}
 */
function isSnapshot(value) {
  if (!isRecord(value) || value.version !== SNAPSHOT_VERSION) return false;
  const {bounds, robots, seeds, stats} = value;
  return (
    typeof value.origin === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    isRecord(bounds) &&
    typeof bounds.pages === 'number' &&
    typeof bounds.budgetMs === 'number' &&
    typeof bounds.robots === 'string' &&
    ROBOTS_MODES.includes(bounds.robots) &&
    typeof bounds.userAgent === 'string' &&
    isRecord(robots) &&
    typeof robots.state === 'string' &&
    ROBOTS_STATES.includes(robots.state) &&
    isRecord(seeds) &&
    typeof seeds.audited === 'number' &&
    typeof seeds.links === 'number' &&
    typeof seeds.sitemap === 'number' &&
    Array.isArray(value.pages) &&
    value.pages.every(isPage) &&
    Array.isArray(value.skipped) &&
    isRecord(stats) &&
    typeof stats.requests === 'number' &&
    typeof stats.elapsedMs === 'number' &&
    typeof stats.truncatedByBudget === 'boolean'
  );
}

export {
  normalizeUrl,
  sameOrigin,
  selectSeeds,
  cacheKey,
  isSnapshot,
  SNAPSHOT_VERSION,
  MAX_BODY_BYTES,
  MAX_TEXT_CHARS,
  MAX_LINKS_PER_PAGE,
  MAX_H1,
  MAX_CANONICALS,
  MAX_REDIRECT_ROUNDS,
  REQUEST_CAP_FACTOR,
  USER_AGENT,
};
