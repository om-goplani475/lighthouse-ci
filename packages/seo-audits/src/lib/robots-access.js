/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Simulates what robots.txt lets specific crawlers fetch: the audited page itself, plus the
 * same-origin CSS/JS the page loaded (blocking those stops a search engine rendering the page the
 * way a visitor sees it). Pure logic — the audit wrapper only resolves Lighthouse artifacts.
 *
 * Allow/disallow matching is `robots-parser` (already a Lighthouse dependency), with two
 * deliberate behaviors layered on top:
 * - `Googlebot-Image` falls back to the `googlebot` group when robots.txt has no
 *   `googlebot-image` group, as Google documents. `robots-parser` alone would fall to `*`.
 * - robots.txt only governs its own origin, so cross-origin CSS/JS (a CDN, say) is skipped: this
 *   file says nothing about it.
 *
 * Only the search-engine crawlers are scored. Blocking an AI crawler (GPTBot, ClaudeBot, ...) is a
 * legitimate content-licensing choice, so those rows are reported, never failed.
 */

import robotsParser from 'robots-parser';
import {Audit} from 'lighthouse/core/audits/audit.js';
import {parseRobotsTxt} from './robots-txt.js';

/**
 * @typedef {{name: string, role: string, scored: boolean, fallback?: string}} Crawler
 * @typedef {{url: string, type: string}} PageResource
 */

/** @type {Crawler[]} */
const CRAWLERS = [
  {name: 'Googlebot', role: 'Search engine', scored: true},
  {name: 'Bingbot', role: 'Search engine', scored: true},
  {
    name: 'Googlebot-Image',
    role: 'Image search (not scored)',
    scored: false,
    fallback: 'Googlebot',
  },
  {name: 'GPTBot', role: 'AI crawler (not scored)', scored: false},
  {name: 'ClaudeBot', role: 'AI crawler (not scored)', scored: false},
  {name: 'CCBot', role: 'AI crawler (not scored)', scored: false},
  {name: 'PerplexityBot', role: 'AI crawler (not scored)', scored: false},
];

const RENDERING_TYPES = new Set(['Stylesheet', 'Script']);
const MAX_LISTED_URLS = 3;

/**
 * @param {{status: number | null, content: string | null}} robotsTxt Only called for a present file.
 * @param {string} pageUrl
 * @param {PageResource[]} resources
 * @return {{rows: Array<{crawler: string, role: string, page: string, assets: string}>, failures: string[]}}
 */
function simulateCrawlerAccess(robotsTxt, pageUrl, resources) {
  const content = /** @type {string} */ (robotsTxt.content);
  const robots = robotsParser(new URL('/robots.txt', pageUrl).href, content);
  const {groups} = parseRobotsTxt(content);
  const origin = new URL(pageUrl).origin;

  const renderingUrls = [
    ...new Set(
      resources
        .filter(r => RENDERING_TYPES.has(r.type) && safeOrigin(r.url) === origin)
        .map(r => r.url)
    ),
  ];

  /** @type {string[]} */
  const failures = [];
  const rows = CRAWLERS.map(crawler => {
    const agent =
      crawler.fallback && !groups.some(g => g.agents.includes(crawler.name.toLowerCase()))
        ? crawler.fallback
        : crawler.name;
    // robots-parser returns undefined for a URL on a different origin; treat as allowed.
    const allowed = /** @param {string} u */ u => robots.isAllowed(u, agent) !== false;

    const pageAllowed = allowed(pageUrl);
    const blocked = renderingUrls.filter(u => !allowed(u));

    if (crawler.scored) {
      if (!pageAllowed) failures.push(`${crawler.name} is blocked from this page`);
      if (blocked.length) {
        failures.push(`${crawler.name} is blocked from ${blocked.length} CSS/JS file(s)`);
      }
    }

    return {
      crawler: crawler.name,
      role: crawler.role,
      page: pageAllowed ? 'Allowed' : 'Blocked',
      assets: blocked.length
        ? `${blocked.length} blocked: ${blocked.slice(0, MAX_LISTED_URLS).join(', ')}`
        : 'None blocked',
    };
  });

  return {rows, failures};
}

/**
 * @param {string} url
 * @return {string | null}
 */
function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof simulateCrawlerAccess>} simulation
 * @return {import('lighthouse/types/audit.js').default.Product}
 */
function buildAccessResult({rows, failures}) {
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'crawler', valueType: 'text', label: 'Crawler'},
    {key: 'role', valueType: 'text', label: 'Type'},
    {key: 'page', valueType: 'text', label: 'This page'},
    {key: 'assets', valueType: 'text', label: 'Same-origin CSS/JS'},
  ];
  const details = Audit.makeTableDetails(headings, rows);

  return failures.length
    ? {score: 0, explanation: `${failures.join('; ')}.`, details}
    : {score: 1, details};
}

export {simulateCrawlerAccess, buildAccessResult, CRAWLERS};
