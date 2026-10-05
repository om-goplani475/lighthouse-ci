/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Requests the alternate versions a page names in its hreflang links, so the audits can tell whether each one
 * answers, is indexable, and links back. Bounded and polite: at most `limit` distinct alternates (never the page
 * itself), hosts in parallel (at most 5) but one request at a time per host, the first 128 KiB of each, about 5 s
 * each and 20 s in all, the crawler's user-agent, no cookies, no redirect followed. An alternate on the page's own
 * origin goes through the normal safe fetch (which honours LHCI_SEO_ALLOW_PRIVATE_NETWORK); one on any other host
 * goes through the strict public-only fetch, which refuses private addresses whatever the environment says.
 * Every outcome is data, never a throw.
 */

import {safeFetchPrefix, safeFetchPublicPrefix} from './safe-fetch.js';
import {errorCodeOf} from './external-link-checker.js';
import {extractHreflangHead} from './hreflang-extract.js';
import {noindexFor} from './robots-directives.js';
import {USER_AGENT} from './crawl-snapshot.js';
import {looseKey} from './url-key.js';

/**
 * @typedef {{
 *   url: string,
 *   hreflang: string,
 *   sameOrigin: boolean,
 *   status: number | null,
 *   redirectLocation: string | null,
 *   error: string | null,
 *   bodyRead: string | null,
 *   truncated: boolean,
 *   noindex: boolean,
 *   canonicals: string[],
 *   alternates: Array<{hreflang: string, href: string}>,
 *   hasHreflang: boolean,
 * }} AlternateCheck
 */

const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 5_000;
const BUDGET_MS = 20_000;
const CONCURRENCY = 5;

/**
 * @param {string} url
 * @param {string} hreflang
 * @param {boolean} sameOrigin
 * @return {AlternateCheck}
 */
function blank(url, hreflang, sameOrigin) {
  return {
    url,
    hreflang,
    sameOrigin,
    status: null,
    redirectLocation: null,
    error: null,
    bodyRead: null,
    truncated: false,
    noindex: false,
    canonicals: [],
    alternates: [],
    hasHreflang: false,
  };
}

/**
 * @param {{url: string, hreflang: string, sameOrigin: boolean}} target
 * @param {typeof safeFetchPrefix} fetchPage
 * @return {Promise<AlternateCheck>}
 */
async function checkOne({url, hreflang, sameOrigin}, fetchPage) {
  const check = blank(url, hreflang, sameOrigin);
  try {
    const response = await fetchPage(url, {
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      userAgent: USER_AGENT,
    });
    check.status = response.status;
    check.redirectLocation = response.redirectLocation;
    check.bodyRead = response.bodyRead;
    check.truncated = response.truncated;
    if (response.bodyRead === 'html') {
      const head = extractHreflangHead(response.body, url, {truncated: response.truncated});
      check.canonicals = head.canonicals;
      check.alternates = head.alternates;
      check.hasHreflang = head.alternates.length > 0;
      check.noindex =
        noindexFor(['googlebot'], {
          metas: head.robotsMetas,
          xRobotsTag: response.headers['x-robots-tag'],
        }).length > 0;
    } else if (response.status >= 200 && response.status < 300) {
      check.noindex =
        noindexFor(['googlebot'], {metas: [], xRobotsTag: response.headers['x-robots-tag']})
          .length > 0;
    }
  } catch (err) {
    check.error = errorCodeOf(err);
  }
  return check;
}

/**
 * @param {{
 *   pageUrl: string,
 *   alternates: Array<{hreflang: string, href: string}>,
 *   limit: number,
 *   fetchSame?: typeof safeFetchPrefix,
 *   fetchPublic?: typeof safeFetchPublicPrefix,
 *   now?: () => number,
 * }} input
 * @return {Promise<{results: AlternateCheck[], notChecked: number}>}
 */
async function checkAlternates({
  pageUrl,
  alternates,
  limit,
  fetchSame = safeFetchPrefix,
  fetchPublic = safeFetchPublicPrefix,
  now = Date.now,
}) {
  /** @type {AlternateCheck[]} */
  const results = [];
  try {
    const selfKey = looseKey(pageUrl);
    const origin = new URL(pageUrl).origin;
    /** @type {Array<{url: string, hreflang: string, sameOrigin: boolean, host: string}>} */
    const wanted = [];
    const seen = new Set();
    for (const alt of Array.isArray(alternates) ? alternates : []) {
      const key = alt && looseKey(alt.href);
      if (!key || key === selfKey || seen.has(key)) continue;
      seen.add(key);
      const url = new URL(alt.href);
      wanted.push({
        url: url.href,
        hreflang: alt.hreflang,
        sameOrigin: url.origin === origin,
        host: url.host,
      });
    }
    const selected = wanted.slice(0, Math.max(0, limit));
    let notChecked = wanted.length - selected.length;

    /** @type {Map<string, typeof selected>} */
    const byHost = new Map();
    for (const target of selected) {
      byHost.set(target.host, [...(byHost.get(target.host) || []), target]);
    }
    const queues = [...byHost.values()];
    const deadline = now() + BUDGET_MS;
    let next = 0;
    const worker = async () => {
      while (next < queues.length) {
        const queue = queues[next++];
        for (const target of queue) {
          if (now() >= deadline) {
            notChecked++;
            continue;
          }
          results.push(await checkOne(target, target.sameOrigin ? fetchSame : fetchPublic));
        }
      }
    };
    await Promise.all(Array.from({length: Math.min(CONCURRENCY, queues.length)}, worker));
    // Keep the page's own order of alternates.
    const order = new Map(selected.map((t, i) => [t.url, i]));
    results.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0));
    return {results, notChecked};
  } catch {
    return {results, notChecked: 0};
  }
}

export {checkAlternates, checkOne, MAX_BYTES, TIMEOUT_MS, BUDGET_MS, CONCURRENCY};
