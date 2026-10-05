/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Status-only checks of the external links on the audited page, for `broken-external-links`. This is the one place
 * in the fork that sends requests to other people's sites, so it is deliberately small and polite:
 *   - only the URLs it is given (the audited page's own external links, already capped), `http` and `https` only;
 *   - every request goes through `safeFetchPublicPrefix`, which refuses a private or reserved address whatever
 *     the environment says (the private-network opt-in is for the audited site, never for a link on its page);
 *   - at most `PER_HOST` requests to any one host in a run, hosts checked in parallel but each host's links one
 *     at a time, at most `CONCURRENCY` requests in flight, `REQUEST_TIMEOUT_MS` per request, redirects followed for at
 *     most `MAX_HOPS` hops (each hop validated like the first request), a total budget of `BUDGET_MS`;
 *   - no body is read (at most 1 KiB of the start of a response), the crawler's user-agent is sent, and no
 *     cookies or credentials ever are;
 *   - a third-party robots.txt is not fetched (a status check of a link the audited site publishes is what a
 *     browser prefetch does), a decision made with the developer.
 * Anything not reached is counted, never guessed. Never throws; every failure is data.
 */

import {safeFetchPublicPrefix} from './safe-fetch.js';
import {USER_AGENT} from './crawl-snapshot.js';

/** @typedef {{url: string, status: number, location: string | null}} ExternalHop */
/**
 * @typedef {{
 *   url: string, finalUrl: string, status: number | null, hops: ExternalHop[],
 *   error: string | null, state: 'checked' | 'not-checked',
 * }} ExternalCheck
 */

const PER_HOST = 2;
const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_HOPS = 3;
const BUDGET_MS = 15_000;
const MAX_BODY_BYTES = 1024;

/**
 * A short code for why a request failed, so audits can tell "gone" from "flaky".
 * @param {unknown} err
 * @return {string}
 */
function errorCodeOf(err) {
  const code =
    err && typeof err === 'object' ? /** @type {{code?: unknown}} */ (err).code : undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (/refusing to (connect|fetch)/i.test(message)) return 'PRIVATE';
  if (typeof code === 'string' && code) {
    if (/^(CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_TLS|ERR_SSL|HOSTNAME_MISMATCH)/.test(code)) {
      return 'TLS';
    }
    return code;
  }
  if (/timed out|timeout/i.test(message)) return 'TIMEOUT';
  if (/certificate|tls|ssl/i.test(message)) return 'TLS';
  return 'OTHER';
}

/**
 * @param {string} url
 * @return {string | null}
 */
function hostOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.host.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} start
 * @param {{fetchPage: typeof safeFetchPublicPrefix, now: () => number, deadline: number}} deps
 * @return {Promise<ExternalCheck>}
 */
async function checkOne(start, {fetchPage, now, deadline}) {
  /** @type {ExternalCheck} */
  const result = {
    url: start,
    finalUrl: start,
    status: null,
    hops: [],
    error: null,
    state: 'checked',
  };
  let current = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (now() >= deadline) {
      if (hop === 0) {
        result.state = 'not-checked';
        return result;
      }
      result.error = 'TIMEOUT';
      return result;
    }
    let response;
    try {
      response = await fetchPage(current, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_BODY_BYTES,
        userAgent: USER_AGENT,
      });
    } catch (err) {
      result.error = errorCodeOf(err);
      result.finalUrl = current;
      return result;
    }
    result.status = response.status;
    result.finalUrl = current;
    const redirect = response.status >= 300 && response.status < 400 && response.redirectLocation;
    if (!redirect) return result;
    let next;
    try {
      next = new URL(response.redirectLocation || '', current);
    } catch {
      return result;
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return result;
    result.hops.push({url: current, status: response.status, location: next.href});
    if (hop === MAX_HOPS) {
      result.error = 'TOO_MANY_REDIRECTS';
      return result;
    }
    current = next.href;
  }
  return result;
}

/**
 * @param {{
 *   links: Array<{url: string}>,
 *   limit: number,
 *   fetchPage?: typeof safeFetchPublicPrefix,
 *   now?: () => number,
 * }} input
 * @return {Promise<{checked: ExternalCheck[], notChecked: number}>}
 */
async function checkExternalLinks({
  links,
  limit,
  fetchPage = safeFetchPublicPrefix,
  now = Date.now,
}) {
  /** @type {ExternalCheck[]} */
  const checked = [];
  try {
    const wanted = [];
    const seen = new Set();
    for (const link of Array.isArray(links) ? links : []) {
      if (!link || typeof link.url !== 'string' || seen.has(link.url) || !hostOf(link.url)) {
        continue;
      }
      seen.add(link.url);
      wanted.push(link.url);
    }
    const selected = wanted.slice(0, Math.max(0, limit));
    let notChecked = wanted.length - selected.length;

    /** @type {Map<string, string[]>} */
    const byHost = new Map();
    for (const url of selected) {
      const host = /** @type {string} */ (hostOf(url));
      const list = byHost.get(host) || [];
      if (list.length < PER_HOST) list.push(url);
      else notChecked++;
      byHost.set(host, list);
    }
    const queues = [...byHost.values()];
    const deadline = now() + BUDGET_MS;
    let next = 0;
    const worker = async () => {
      while (next < queues.length) {
        const queue = queues[next++];
        // One host at a time within a worker, so no host ever sees two requests at once.
        for (const url of queue) {
          const result = await checkOne(url, {fetchPage, now, deadline});
          if (result.state === 'not-checked') notChecked++;
          else checked.push(result);
        }
      }
    };
    await Promise.all(Array.from({length: Math.min(CONCURRENCY, queues.length)}, worker));
    return {checked, notChecked};
  } catch {
    return {checked, notChecked: 0};
  }
}

export {
  checkExternalLinks,
  errorCodeOf,
  PER_HOST,
  CONCURRENCY,
  MAX_HOPS,
  BUDGET_MS,
  MAX_BODY_BYTES,
};
