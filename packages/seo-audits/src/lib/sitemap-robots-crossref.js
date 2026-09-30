/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure cross-check of a sitemap's URLs against the site's robots.txt: no I/O, no requests. A sitemap
 * says "please index these"; robots.txt says "do not crawl these". A URL that is both listed and
 * disallowed is a contradiction, and this finds every one (all stored URLs, not a sample, since it
 * costs nothing beyond matching).
 *
 * robots.txt only governs the origin it is served from, so only sitemap URLs on the page's own
 * origin are checked; the rest are counted and skipped. Matching is `robots-parser` (as in
 * `robots-access.js`), for the search-engine crawlers scored there (Googlebot and Bingbot).
 */

import robotsParser from 'robots-parser';
import {CRAWLERS} from './robots-access.js';

/** @typedef {import('./sitemap-parse.js').SitemapDocument} SitemapDocument */

const SEARCH_CRAWLERS = CRAWLERS.filter(crawler => crawler.scored);
const MAX_ROWS = 20;

/**
 * @param {string} url
 * @return {string | null}
 */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * For "is the audited page listed": drop the fragment and a trailing slash on a non-root path, so
 * `/a/` and `/a` match. Informational only, so this tolerance cannot cause a wrong failure.
 * @param {string} url
 * @return {string}
 */
function normalizeForPageMatch(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * @param {ReturnType<typeof robotsParser>} robots
 * @param {string} url
 * @return {string[]} Names of the scored crawlers robots.txt disallows for this URL.
 */
function blockedFor(robots, url) {
  return SEARCH_CRAWLERS.filter(crawler => robots.isAllowed(url, crawler.name) === false).map(
    crawler => crawler.name
  );
}

/**
 * @param {{
 *   robotsContent: string,
 *   pageUrl: string,
 *   documents: SitemapDocument[],
 * }} input `robotsContent` is the text of a robots.txt that was actually retrieved.
 * @return {{
 *   checked: number,
 *   skippedCrossOrigin: number,
 *   blockedTotal: number,
 *   blockedUrls: Array<{url: string, crawlers: string[]}>,
 *   blockedSitemaps: Array<{url: string, crawlers: string[]}>,
 *   pageListed: boolean | null,
 * }}
 */
function crossReference({robotsContent, pageUrl, documents}) {
  const origin = originOf(pageUrl);
  const robots = robotsParser(new URL('/robots.txt', pageUrl).href, robotsContent);

  const seen = new Set();
  let checked = 0;
  let skippedCrossOrigin = 0;
  let blockedTotal = 0;
  /** @type {Array<{url: string, crawlers: string[]}>} */
  const blockedUrls = [];
  /** @type {Array<{url: string, crawlers: string[]}>} */
  const blockedSitemaps = [];

  const listed = new Set();
  let sawUrlList = false;

  for (const doc of documents) {
    // The sitemap file itself: is its own path disallowed? Only meaningful on robots.txt's origin.
    if (
      (doc.source === 'declared' || doc.source === 'default-location') &&
      originOf(doc.url) === origin
    ) {
      const crawlers = blockedFor(robots, doc.url);
      if (crawlers.length) blockedSitemaps.push({url: doc.url, crawlers});
    }

    if (doc.outcome !== 'ok' || doc.kind !== 'urlset') continue;
    sawUrlList = true;
    for (const loc of doc.locs) {
      listed.add(normalizeForPageMatch(loc));
      if (seen.has(loc)) continue;
      seen.add(loc);
      if (originOf(loc) !== origin) {
        skippedCrossOrigin += 1;
        continue;
      }
      checked += 1;
      const crawlers = blockedFor(robots, loc);
      if (crawlers.length) {
        blockedTotal += 1;
        if (blockedUrls.length < MAX_ROWS) blockedUrls.push({url: loc, crawlers});
      }
    }
  }

  return {
    checked,
    skippedCrossOrigin,
    blockedTotal,
    blockedUrls,
    blockedSitemaps,
    pageListed: sawUrlList ? listed.has(normalizeForPageMatch(pageUrl)) : null,
  };
}

export {crossReference, MAX_ROWS};
