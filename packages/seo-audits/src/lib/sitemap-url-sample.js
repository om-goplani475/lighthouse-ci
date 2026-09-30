/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure logic for `sitemap-url-status`: choose a bounded, deterministic sample of the URLs a
 * sitemap lists and check each one's HTTP status. No I/O of its own — the status fetcher is
 * injected, so every bound here (sample size, concurrency, per-request and total time, retry) is
 * tested without a network. Not a crawler: it never follows a redirect and never reads a body.
 */

/** @typedef {import('./sitemap-parse.js').SitemapDocument} SitemapDocument */
/**
 * `response` is whatever the injected fetcher resolved, untouched (a plain `{status}` fetcher gives
 * `{status}`; the page fetcher's headers and body prefix ride along), so callers that need more than
 * the status can use it without `checkUrls` knowing what it is. Absent when the URL errored or was not
 * checked.
 * @typedef {{
 *   url: string,
 *   status: number | null,
 *   redirectLocation: string | null,
 *   error: string | null,
 *   notChecked: boolean,
 *   response?: {status: number, redirectLocation?: string | null},
 * }} UrlCheck
 */
/**
 * A fetcher may resolve more than these fields (the page fetcher adds headers and a body prefix);
 * they are kept on `UrlCheck.response`.
 * @typedef {(url: string) => Promise<{status: number, redirectLocation?: string | null}>} FetchStatus
 */

const SAMPLE_SIZE_ENV = 'LHCI_SEO_SITEMAP_SAMPLE_SIZE';
const DEFAULT_SAMPLE_SIZE = 10;
const MAX_SAMPLE_SIZE = 25;
const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 5_000;
const TOTAL_BUDGET_MS = 30_000;

/**
 * How many URLs to check: `LHCI_SEO_SITEMAP_SAMPLE_SIZE` if it is a whole number, clamped to
 * 1..MAX_SAMPLE_SIZE, else the default. Read from the process environment (never the page) on each
 * call. The cap exists because this is a resource bound: more requests to the audited host.
 * @param {NodeJS.ProcessEnv} [env]
 * @return {number}
 */
function resolveSampleSize(env = process.env) {
  const raw = env[SAMPLE_SIZE_ENV];
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return DEFAULT_SAMPLE_SIZE;
  const n = parseInt(raw, 10);
  return Math.min(MAX_SAMPLE_SIZE, Math.max(1, n));
}

/**
 * Evenly spaced, deterministic selection that always includes the first and last item (so a broken
 * tail is caught, not just the top of the sitemap) and is identical on every run.
 * @template T
 * @param {T[]} items
 * @param {number} n
 * @return {T[]}
 */
function pickEvenly(items, n) {
  if (items.length <= n) return items.slice();
  if (n === 1) return [items[0]];
  const picked = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    const index = Math.round((i * (items.length - 1)) / (n - 1));
    if (index !== last) picked.push(items[index]);
    last = index;
  }
  return picked;
}

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
 * The URLs eligible for checking: `<url>` entries of fetched, parsed `urlset` documents, in
 * document order, de-duplicated, and only those on the same origin as the sitemap that listed them
 * (the protocol requires that; it also means a sitemap cannot point this check at other hosts).
 * Anything else is counted as skipped, never requested.
 * @param {SitemapDocument[]} documents
 * @return {{urls: string[], skippedCrossOrigin: number}}
 */
function collectEligibleUrls(documents) {
  const seen = new Set();
  const urls = [];
  let skippedCrossOrigin = 0;
  for (const doc of documents) {
    if (doc.outcome !== 'ok' || doc.kind !== 'urlset') continue;
    const sitemapOrigin = originOf(doc.url);
    for (const loc of doc.locs) {
      if (seen.has(loc)) continue;
      seen.add(loc);
      if (originOf(loc) === sitemapOrigin) urls.push(loc);
      else skippedCrossOrigin += 1;
    }
  }
  return {urls, skippedCrossOrigin};
}

/**
 * @param {FetchStatus} fetchStatus
 * @param {string} url
 * @param {number} timeoutMs Hard limit, enforced here too: the fetcher's own timeout is only an
 *   idle timeout, which a server dribbling its response headers would never trip.
 * @return {Promise<UrlCheck>}
 */
async function checkOne(fetchStatus, url, timeoutMs) {
  /** @type {UrlCheck} */
  const result = {url, status: null, redirectLocation: null, error: null, notChecked: false};
  // One retry, for a network error only (never for an HTTP status): a single transient failure
  // should not fail a CI run.
  for (let attempt = 0; attempt < 2; attempt++) {
    // `any`: this monorepo's pinned 2019-era @types/node gives setTimeout/clearTimeout handle types
    // that do not agree with each other.
    /** @type {any} */
    let timer;
    try {
      /** @type {{status: number, redirectLocation?: string | null}} */
      const response = await Promise.race([
        fetchStatus(url),
        /** @type {Promise<never>} */ (
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`timed out after ${timeoutMs}ms`)),
              timeoutMs
            );
          })
        ),
      ]);
      result.status = response.status;
      result.redirectLocation = response.redirectLocation || null;
      result.response = response;
      result.error = null;
      return result;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      delete result.response;
    } finally {
      clearTimeout(timer);
    }
  }
  return result;
}

/**
 * Checks each URL with a small worker pool and a total time budget. A URL the budget ran out
 * before starting is returned with `notChecked: true`, so a partial check is never mistaken for a
 * complete one. Results keep the input order.
 * @param {string[]} urls
 * @param {{
 *   fetchStatus: FetchStatus,
 *   concurrency?: number,
 *   timeoutMs?: number,
 *   budgetMs?: number,
 *   now?: () => number,
 * }} options
 * @return {Promise<UrlCheck[]>}
 */
async function checkUrls(urls, options) {
  const {
    fetchStatus,
    concurrency = CONCURRENCY,
    timeoutMs = REQUEST_TIMEOUT_MS,
    budgetMs = TOTAL_BUDGET_MS,
    now = Date.now,
  } = options;
  const deadline = now() + budgetMs;
  /** @type {UrlCheck[]} */
  const results = new Array(urls.length);
  let next = 0;

  const worker = async () => {
    while (next < urls.length) {
      const index = next++;
      if (now() >= deadline) {
        results[index] = {
          url: urls[index],
          status: null,
          redirectLocation: null,
          error: null,
          notChecked: true,
        };
      } else {
        results[index] = await checkOne(fetchStatus, urls[index], timeoutMs);
      }
    }
  };
  await Promise.all(Array.from({length: Math.min(concurrency, urls.length)}, worker));
  return results;
}

/**
 * @param {UrlCheck} check
 * @return {string}
 */
function describeCheck(check) {
  if (check.notChecked) return 'not checked (time budget used up)';
  if (check.error) return `could not be fetched: ${check.error}`;
  if (check.redirectLocation) return `HTTP ${check.status}, redirects to ${check.redirectLocation}`;
  return `HTTP ${check.status}`;
}

export {
  SAMPLE_SIZE_ENV,
  DEFAULT_SAMPLE_SIZE,
  MAX_SAMPLE_SIZE,
  CONCURRENCY,
  REQUEST_TIMEOUT_MS,
  TOTAL_BUDGET_MS,
  resolveSampleSize,
  pickEvenly,
  collectEligibleUrls,
  checkUrls,
  describeCheck,
};
