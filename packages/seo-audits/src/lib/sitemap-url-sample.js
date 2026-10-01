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

import {safeFetchPrefix} from './safe-fetch.js';
import {extractHeadSignals} from './html-head-signals.js';

/** @typedef {import('./sitemap-parse.js').SitemapDocument} SitemapDocument */
/** @typedef {import('./sitemap-parse.js').SampledPage} SampledPage */
/** @typedef {import('./sitemap-parse.js').UrlSample} UrlSample */
/** @typedef {import('./safe-fetch.js').PrefixResult} PrefixResult */
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
 * Reduces one check to the compact, serializable `SampledPage` kept in the artifact. Raw bodies are
 * never kept: for an HTML response the body prefix is turned into the extracted head signals and
 * dropped. A plain `{status}` response (or an errored / not-checked URL) yields empty signals.
 * @param {UrlCheck} check
 * @return {SampledPage}
 */
function toSampledPage(check) {
  const response = /** @type {Partial<PrefixResult> | undefined} */ (check.response);
  const headers = response && response.headers;
  const bodyRead = (response && response.bodyRead) || null;
  const truncated = Boolean(response && response.truncated);
  const signals =
    response && bodyRead === 'html' && response.body
      ? extractHeadSignals(response.body, {truncated})
      : {metas: [], canonicals: [], headComplete: false};
  return {
    url: check.url,
    status: check.status,
    redirectLocation: check.redirectLocation,
    error: check.error,
    notChecked: check.notChecked,
    contentType: (headers && headers['content-type'] && headers['content-type'][0]) || null,
    xRobotsTag: headers && headers['x-robots-tag'] ? headers['x-robots-tag'].slice() : [],
    bodyRead,
    truncated,
    metas: signals.metas,
    canonicals: signals.canonicals,
    headComplete: signals.headComplete,
  };
}

/**
 * Samples the URLs a sitemap lists and requests each once, returning what the sitemap audits need:
 * status (for `sitemap-url-status`) and the head signals read from the response (for
 * `sitemap-indexability`). Same selection and bounds as ever: same-origin only, evenly spread and
 * deterministic, size from `LHCI_SEO_SITEMAP_SAMPLE_SIZE`, then `checkUrls`' concurrency, timeouts,
 * retry and total budget. Returns `null` when there is no eligible URL.
 * @param {SitemapDocument[]} documents
 * @param {{fetchPage?: FetchStatus, env?: NodeJS.ProcessEnv, now?: () => number}} [deps]
 *   `fetchPage` is injectable so tests never touch the network.
 * @return {Promise<UrlSample | null>}
 */
async function collectUrlSample(
  documents,
  {fetchPage = safeFetchPrefix, env = process.env, now = Date.now} = {}
) {
  const {urls, skippedCrossOrigin} = collectEligibleUrls(documents);
  if (urls.length === 0) return null;

  const sampleSize = resolveSampleSize(env);
  const sample = pickEvenly(urls, sampleSize);
  const checks = await checkUrls(sample, {fetchStatus: fetchPage, now});
  return {
    sampleSize,
    eligibleCount: urls.length,
    skippedCrossOrigin,
    pages: checks.map(toSampledPage),
  };
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
  collectUrlSample,
  toSampledPage,
  describeCheck,
};
