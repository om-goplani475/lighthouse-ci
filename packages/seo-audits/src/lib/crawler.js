/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The bounded site crawl: fetches the audited page, the site's homepage, a share of the audited page's own
 * links and of the sitemap's URLs, then follows same-origin links breadth-first for up to
 * `LHCI_SEO_CRAWL_MAX_DEPTH` hops (default 3) and reduces each page to a snapshot entry
 * (`crawl-extract.js`). Never throws: every failure is data in the returned artifact.
 *
 * Bounds, all constants or clamped environment variables (never settable by the audited page): at most
 * `LHCI_SEO_CRAWL_MAX_PAGES` pages (default 50), 5 requests at a time, 5 s per request with one retry for a
 * network error, a 512 KiB body per page, redirects followed for at most 3 rounds and only within the
 * origin, a request cap of 3 x pages, and a total budget (`LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS`, default
 * 120 s) after which what is left is recorded as not checked. Link-following is breadth-first, so when the
 * page cap bites it is the deepest pages that are left out; URLs that look like files rather than pages
 * are not requested, and at most `MAX_QUERY_VARIANTS` query-string variants of one path are (a crawl trap
 * guard); both are recorded as skipped. The snapshot says whether the page cap, the depth bound or the time
 * budget cut the crawl, so an audit that needs a complete graph can say it was not.
 *
 * Safety: every request is built from the audited page's own origin, never from anything the page says
 * except as a candidate URL that is requested only if it is on that same origin; a redirect off the origin
 * is recorded and never requested. robots.txt is honoured by default (`LHCI_SEO_CRAWL_RESPECT_ROBOTS`
 * turns that off for auditing one's own staging site); if it cannot be read, only the audited page is
 * requested. All requests go through `safe-fetch.js` (address policy, `LHCI_SEO_ALLOW_PRIVATE_NETWORK`).
 *
 * Every dependency is injectable so the tests never touch the network or the disk.
 */

import robotsParser from 'robots-parser';
import {safeFetchPrefix, safeFetchBytes, safeFetchPublicPrefix} from './safe-fetch.js';
import {checkExternalLinks} from './external-link-checker.js';
import {checkUrls, pickEvenly, REQUEST_TIMEOUT_MS} from './sitemap-url-sample.js';
import {collectSitemapDocuments} from '../gatherers/sitemap-documents.js';
import {extractPage} from './crawl-extract.js';
import {
  cacheKey,
  normalizeUrl,
  sameOrigin,
  selectSeeds,
  MAX_BODY_BYTES,
  MAX_EXTERNAL_LINKS_TOTAL,
  MAX_QUERY_VARIANTS,
  MAX_REDIRECT_ROUNDS,
  REQUEST_CAP_FACTOR,
  SNAPSHOT_VERSION,
  USER_AGENT,
} from './crawl-snapshot.js';
import {resolveCacheSettings, readSnapshot, writeSnapshot} from './crawl-cache.js';

/** @typedef {import('./crawl-snapshot.js').CrawlSnapshot} CrawlSnapshot */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('./crawl-snapshot.js').CrawlHop} CrawlHop */
/** @typedef {import('./crawl-snapshot.js').CrawlSkip} CrawlSkip */
/** @typedef {import('./crawl-snapshot.js').CrawlRobotsState} CrawlRobotsState */
/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./sitemap-url-sample.js').UrlCheck} UrlCheck */

const DEFAULT_PAGES = 50;
const MAX_PAGES = 200;
const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 5;
const DEFAULT_LINK_CHECKS = 100;
const MAX_LINK_CHECKS = 200;
const DEFAULT_EXTERNAL_CHECKS = 20;
const MAX_EXTERNAL_CHECKS = 50;
// A status-only check reads only the start of a body: the answer is the status and the redirect, not the page.
const LINK_CHECK_MAX_BYTES = 2 * 1024;
const LINK_CHECK_BUDGET_MS = 30_000;
// URLs that are plainly files, not pages: not worth a page slot (an image, a script, an archive).
const FILE_EXTENSION =
  /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|map|json|xml|txt|pdf|zip|gz|tgz|tar|rar|7z|mp[34]|m4a|wav|ogg|webm|avi|mov|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|exe|dmg|apk)$/i;
const DEFAULT_BUDGET_SECONDS = 120;
const SINGLE_PAGE_BUDGET_MS = 30_000;
const ROBOTS_TIMEOUT_MS = 5_000;
const ROBOTS_MAX_BYTES = 1024 * 1024;
const MAX_SITEMAP_URLS = 2_000;
const MAX_SKIPPED_LISTED = 200;
const MAX_XROBOTS_VALUES = 10;
const MAX_DETAIL_CHARS = 300;

/**
 * @param {string | undefined} value
 * @return {boolean} True only for exactly `0` or `false`.
 */
const isOff = value => value === '0' || value === 'false';

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @return {number}
 */
function clampedInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw || '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @return {{enabled: boolean, pages: number, depth: number, linkChecks: number, externalChecks: number, budgetMs: number, robots: 'honour' | 'ignore'}}
 */
function parseConfig(env) {
  return {
    enabled: !isOff(env.LHCI_SEO_CRAWL),
    pages: clampedInt(env.LHCI_SEO_CRAWL_MAX_PAGES, DEFAULT_PAGES, 1, MAX_PAGES),
    depth: clampedInt(env.LHCI_SEO_CRAWL_MAX_DEPTH, DEFAULT_DEPTH, 1, MAX_DEPTH),
    linkChecks: clampedInt(
      env.LHCI_SEO_CRAWL_MAX_LINK_CHECKS,
      DEFAULT_LINK_CHECKS,
      0,
      MAX_LINK_CHECKS
    ),
    externalChecks: clampedInt(
      env.LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS,
      DEFAULT_EXTERNAL_CHECKS,
      0,
      MAX_EXTERNAL_CHECKS
    ),
    budgetMs:
      clampedInt(env.LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS, DEFAULT_BUDGET_SECONDS, 10, 600) * 1000,
    robots: isOff(env.LHCI_SEO_CRAWL_RESPECT_ROBOTS) ? 'ignore' : 'honour',
  };
}

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_DETAIL_CHARS ? text : `${text.slice(0, MAX_DETAIL_CHARS)}...`;
}

/**
 * @param {unknown} err
 * @return {string}
 */
function messageOf(err) {
  return clip(err instanceof Error ? err.message : String(err));
}

/** The list of URLs that were not crawled and why, capped so a huge sitemap cannot bloat the snapshot. */
function createSkips() {
  /** @type {CrawlSkip[]} */
  const list = [];
  let overflow = 0;
  return {
    /**
     * @param {string} url
     * @param {CrawlSkip['reason']} reason
     * @param {string | null} detail
     */
    add(url, reason, detail) {
      if (list.length < MAX_SKIPPED_LISTED) list.push({url: clip(url), reason, detail});
      else overflow++;
    },
    /** @return {CrawlSkip[]} */
    finish() {
      if (overflow > 0) {
        list.push({
          url: '(more)',
          reason: 'over-page-cap',
          detail: `${overflow} more URL(s) not listed`,
        });
      }
      return list;
    },
  };
}

/**
 * @param {{origin: string, mode: 'honour' | 'ignore', fetchBytes: typeof safeFetchBytes}} input
 * @return {Promise<{state: CrawlRobotsState, allowed: (url: string) => boolean, reason: string | null}>}
 */
async function loadRobots({origin, mode, fetchBytes}) {
  if (mode === 'ignore') return {state: 'ignored', allowed: () => true, reason: null};
  const url = `${origin}/robots.txt`;
  try {
    const response = await fetchBytes(url, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: ROBOTS_MAX_BYTES,
    });
    if (response.status >= 200 && response.status < 300) {
      const robots = robotsParser(url, response.body.toString('utf8'));
      return {
        state: 'present',
        allowed: target => robots.isAllowed(target, USER_AGENT) !== false,
        reason: null,
      };
    }
    if (response.status >= 400 && response.status < 500) {
      return {state: 'absent', allowed: () => true, reason: null};
    }
    return {
      state: 'unavailable',
      allowed: () => false,
      reason: `robots.txt returned HTTP ${response.status}`,
    };
  } catch (err) {
    return {state: 'unavailable', allowed: () => false, reason: messageOf(err)};
  }
}

/**
 * The sitemap's URL list, through the existing Phase 4 discovery. Its own page sample is switched off by
 * giving it a fetcher that refuses, so the crawler makes no request it did not ask for.
 * @param {{auditedUrl: string, collectSitemap: typeof collectSitemapDocuments, fetchBytes: typeof safeFetchBytes, env: NodeJS.ProcessEnv, now: () => number}} input
 * @return {Promise<string[]>}
 */
async function loadSitemapUrls({auditedUrl, collectSitemap, fetchBytes, env, now}) {
  try {
    const artifact = await collectSitemap(
      {finalDisplayedUrl: auditedUrl},
      {
        fetchBytes,
        fetchPage: async () => {
          throw new Error('the crawler does not use the sitemap page sample');
        },
        env,
        now,
      }
    );
    const locs = artifact.documents
      .filter(doc => doc.outcome === 'ok' && doc.kind === 'urlset')
      .flatMap(doc => doc.locs);
    return pickEvenly(locs, MAX_SITEMAP_URLS);
  } catch {
    return [];
  }
}

/**
 * Requests one level of URLs, following same-origin redirects for a few rounds, and turns every checked URL
 * into a page entry. Shared by the full crawl (once per level) and by the single-page top-up of a cached
 * snapshot. `visited` is shared across levels so a redirect target already requested is not requested again.
 * @param {{
 *   seeds: Array<{url: string, source: CrawlPage['source'], depth: number}>,
 *   origin: string,
 *   allowed: (url: string) => boolean,
 *   requestCap: number,
 *   visited: Set<string>,
 *   deadline: number,
 *   fetchPage: typeof safeFetchPrefix,
 *   skips: ReturnType<typeof createSkips>,
 *   now: () => number,
 *   maxBytes?: number,
 *   followVisited?: boolean,
 * }} input
 * @return {Promise<{pages: CrawlPage[], requests: number, truncatedByBudget: boolean, firstError: string | null}>}
 */
async function fetchPages({
  seeds,
  origin,
  allowed,
  requestCap,
  visited,
  deadline,
  fetchPage,
  skips,
  now,
  maxBytes = MAX_BODY_BYTES,
  followVisited = false,
}) {
  /** @type {Array<{source: CrawlPage['source'], url: string, depth: number, current: string, hops: CrawlHop[], check: UrlCheck | null}>} */
  const entries = seeds.map(seed => ({
    source: seed.source,
    url: seed.url,
    depth: seed.depth,
    current: seed.url,
    hops: [],
    check: null,
  }));
  for (const seed of seeds) visited.add(seed.url);
  let requests = 0;
  let truncatedByBudget = false;
  /** @type {string | null} */
  let firstError = null;
  let active = entries.slice();

  for (let round = 0; round <= MAX_REDIRECT_ROUNDS && active.length > 0; round++) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      truncatedByBudget = true;
      for (const entry of active) {
        skips.add(entry.current, 'not-checked', 'the crawl time budget ran out');
      }
      break;
    }
    const room = Math.max(0, requestCap - requests);
    const batch = active.slice(0, room);
    for (const entry of active.slice(room)) {
      skips.add(entry.current, 'not-checked', 'the request cap was reached');
    }
    if (batch.length === 0) break;
    requests += batch.length;

    const checks = await checkUrls(
      batch.map(entry => entry.current),
      {
        fetchStatus: url =>
          fetchPage(url, {
            timeoutMs: REQUEST_TIMEOUT_MS,
            maxBytes,
            userAgent: USER_AGENT,
          }),
        budgetMs: remaining,
        now,
      }
    );

    /** @type {typeof entries} */
    const next = [];
    batch.forEach((entry, index) => {
      const check = checks[index];
      entry.check = check;
      if (check.error && firstError === null) firstError = clip(check.error);
      if (check.notChecked) {
        // Never requested: not a page, and not an unanswered one. Recorded as not checked.
        truncatedByBudget = true;
        skips.add(entry.current, 'not-checked', 'the crawl time budget ran out');
        return;
      }
      if (
        !(
          check.status !== null &&
          check.status >= 300 &&
          check.status < 400 &&
          check.redirectLocation
        )
      ) {
        return;
      }
      const target = normalizeUrl(check.redirectLocation, entry.current);
      // Recorded resolved when it can be, as written (cut) when it cannot.
      entry.hops.push({
        url: entry.current,
        status: check.status,
        location: target ?? clip(check.redirectLocation),
      });
      if (!target) {
        skips.add(entry.current, 'failed', 'a redirect with an unusable Location');
      } else if (!sameOrigin(target, origin)) {
        skips.add(target, 'cross-origin', `a redirect from ${entry.current}, not requested`);
      } else if (!allowed(target)) {
        skips.add(target, 'blocked-by-robots', `a redirect from ${entry.current}`);
      } else if (visited.has(target) && !followVisited) {
        skips.add(
          target,
          'not-checked',
          `a redirect from ${entry.current} to a URL already requested`
        );
      } else if (round >= MAX_REDIRECT_ROUNDS) {
        skips.add(target, 'failed', 'too many redirects');
      } else {
        visited.add(target);
        entry.current = target;
        next.push(entry);
      }
    });
    active = next;
  }

  /** @type {CrawlPage[]} */
  const out = [];
  for (const entry of entries) {
    if (!entry.check || entry.check.notChecked) continue;
    out.push(toPage(entry));
  }
  return {pages: out, requests, truncatedByBudget, firstError};
}

/**
 * @param {{source: CrawlPage['source'], url: string, depth: number, current: string, hops: CrawlHop[], check: UrlCheck | null}} entry
 * @return {CrawlPage}
 */
function toPage(entry) {
  const check = /** @type {UrlCheck} */ (entry.check);
  const response = /** @type {import('./safe-fetch.js').PrefixResult | undefined} */ (
    check.response
  );
  const headers = response && response.headers;
  const status = check.status;
  /** @type {CrawlPage} */
  const page = {
    url: entry.url,
    finalUrl: entry.current,
    redirects: entry.hops,
    status,
    contentType: (headers && headers['content-type'] && headers['content-type'][0]) || null,
    bytes: response && response.body ? response.body.length : 0,
    truncated: Boolean(response && response.truncated),
    title: null,
    description: null,
    canonicals: [],
    robotsMetas: [],
    xRobotsTag:
      headers && headers['x-robots-tag']
        ? headers['x-robots-tag'].slice(0, MAX_XROBOTS_VALUES).map(clip)
        : [],
    h1: [],
    textHash: null,
    textLength: 0,
    wordCount: 0,
    links: [],
    externalLinks: [],
    pagination: {next: [], prev: []},
    depth: entry.depth,
    source: entry.source,
    extraction: 'skipped-status',
  };

  if (check.error || status === null) {
    page.extraction = 'error';
    return page;
  }
  if (!(status >= 200 && status < 300)) return page;
  if (!response || response.bodyRead !== 'html') {
    page.extraction = 'skipped-not-html';
    return page;
  }
  try {
    const extract = extractPage(response.body, entry.current, {truncated: page.truncated});
    Object.assign(page, extract, {extraction: 'ok'});
  } catch {
    page.extraction = 'error';
  }
  return page;
}

/**
 * @param {string[]} urls
 * @return {string[]} The URLs in order, without duplicates.
 */
function unique(urls) {
  return [...new Set(urls)];
}

/**
 * Whether a URL is worth a page slot: not a plain file (an image, a script, an archive).
 * @param {string} url
 * @return {boolean}
 */
function looksLikePage(url) {
  try {
    return !FILE_EXTENSION.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * The crawl proper: requests the seeds, then repeatedly the same-origin links found on the pages just
 * fetched (breadth-first, so the deepest pages are what the page cap leaves out), until the depth bound, the
 * page cap, the request cap or the time budget stops it. Leftover sitemap URLs fill slots the link-following
 * leaves spare.
 * @param {{
 *   seeds: Array<{url: string, source: CrawlPage['source'], depth: number}>,
 *   leftoverLinks: string[],
 *   leftoverSitemap: string[],
 *   origin: string,
 *   allowed: (url: string) => boolean,
 *   config: ReturnType<typeof parseConfig>,
 *   started: number,
 *   fetchPage: typeof safeFetchPrefix,
 *   skips: ReturnType<typeof createSkips>,
 *   now: () => number,
 *   follow: boolean,
 * }} input
 * @return {Promise<{pages: CrawlPage[], requests: number, truncatedByBudget: boolean, firstError: string | null, overPageCap: boolean, cutByDepth: boolean}>}
 */
async function crawlLevels({
  seeds,
  leftoverLinks,
  leftoverSitemap,
  origin,
  allowed,
  config,
  started,
  fetchPage,
  skips,
  now,
  follow,
}) {
  const requestCap = config.pages * REQUEST_CAP_FACTOR;
  const deadline = started + config.budgetMs;
  const visited = new Set(seeds.map(seed => seed.url));
  // Every URL ever considered as a candidate, so each is judged (and any skip recorded) once.
  const considered = new Set(visited);
  /** @type {Map<string, Set<string>>} */
  const variants = new Map();
  /** @param {string} url @return {boolean} Whether the URL is within the query-variant limit (and counts it). */
  const withinVariantLimit = url => {
    const parsed = new URL(url);
    if (!parsed.search) return true;
    const set = variants.get(parsed.pathname) || new Set();
    variants.set(parsed.pathname, set);
    if (set.has(parsed.search)) return true;
    if (set.size >= MAX_QUERY_VARIANTS) return false;
    set.add(parsed.search);
    return true;
  };
  for (const seed of seeds) withinVariantLimit(seed.url);

  /** @type {CrawlPage[]} */
  const pages = [];
  let requests = 0;
  let truncatedByBudget = false;
  /** @type {string | null} */
  let firstError = null;
  let overPageCap = false;
  let cutByDepth = false;
  let pendingLinks = leftoverLinks.map(url => ({url, depth: 1}));
  let sitemapPool = leftoverSitemap.slice();
  /** @type {Array<{url: string, source: CrawlPage['source'], depth: number}>} */
  let level = seeds;

  while (level.length > 0) {
    const fetched = await fetchPages({
      seeds: level,
      origin,
      allowed,
      requestCap: requestCap - requests,
      visited,
      deadline,
      fetchPage,
      skips,
      now,
    });
    pages.push(...fetched.pages);
    requests += fetched.requests;
    if (fetched.firstError && firstError === null) firstError = fetched.firstError;
    if (fetched.truncatedByBudget) {
      truncatedByBudget = true;
      break;
    }
    if (!follow || requests >= requestCap) break;

    // Candidates for the next level: leftover seed links first, then the links of the pages just fetched,
    // shallower parents before deeper ones.
    /** @type {Array<{url: string, depth: number}>} */
    const found = pendingLinks;
    pendingLinks = [];
    const parents = fetched.pages
      .filter(page => page.extraction === 'ok')
      .sort((a, b) => a.depth - b.depth);
    for (const page of parents) {
      for (const link of page.links) found.push({url: link.url, depth: page.depth + 1});
    }
    /** @type {Array<{url: string, source: CrawlPage['source'], depth: number}>} */
    const candidates = [];
    for (const {url, depth} of found) {
      if (visited.has(url) || considered.has(url)) continue;
      if (depth > config.depth) {
        // Found on a page at the depth bound: a page exists that the crawl will not go to. Not marked as
        // considered, so a shallower page found later can still lead to it.
        if (allowed(url) && looksLikePage(url)) cutByDepth = true;
        continue;
      }
      considered.add(url);
      if (!allowed(url)) {
        skips.add(url, 'blocked-by-robots', null);
      } else if (!looksLikePage(url)) {
        skips.add(url, 'not-a-page', 'the URL looks like a file, not a page');
      } else if (!withinVariantLimit(url)) {
        skips.add(
          url,
          'query-variants',
          `more than ${MAX_QUERY_VARIANTS} query variants of this path`
        );
      } else {
        candidates.push({url, source: 'link', depth});
      }
    }

    let room = Math.max(0, config.pages - pages.length);
    let next = candidates;
    if (candidates.length > room) {
      overPageCap = true;
      const picked = new Set(pickEvenlyKeepingOrder(candidates, room));
      for (const candidate of candidates) {
        if (!picked.has(candidate)) skips.add(candidate.url, 'over-page-cap', null);
      }
      next = candidates.filter(candidate => picked.has(candidate));
    }
    room -= next.length;
    // Slots the link-following leaves spare go to the sitemap's remaining URLs.
    if (room > 0 && sitemapPool.length > 0) {
      sitemapPool = sitemapPool.filter(url => !visited.has(url) && !considered.has(url));
      const picked = pickEvenly(sitemapPool, Math.min(room, sitemapPool.length));
      const pickedSet = new Set(picked);
      sitemapPool = sitemapPool.filter(url => !pickedSet.has(url));
      for (const url of picked) {
        considered.add(url);
        next.push({url, source: 'sitemap', depth: 0});
      }
    }
    level = next;
  }

  // Whatever is still waiting for a slot was left out by the page cap.
  for (const url of sitemapPool) {
    if (!visited.has(url) && !considered.has(url)) {
      skips.add(url, 'over-page-cap', null);
      overPageCap = true;
    }
  }
  return {pages, requests, truncatedByBudget, firstError, overPageCap, cutByDepth};
}

/**
 * `pickEvenly` for objects: the same evenly spread, deterministic choice, returned as the chosen elements.
 * @template T
 * @param {T[]} items
 * @param {number} count
 * @return {T[]}
 */
function pickEvenlyKeepingOrder(items, count) {
  if (count <= 0) return [];
  const indexes = pickEvenly(
    items.map((_, index) => index),
    count
  );
  return indexes.map(index => items[index]);
}

/**
 * At most `MAX_EXTERNAL_LINKS_TOTAL` distinct external URLs across the whole snapshot, in page order, so
 * the cache file stays small however many outbound links a hostile site has.
 * @param {CrawlPage[]} pages
 */
function limitExternalLinks(pages) {
  const seen = new Set();
  for (const page of pages) {
    page.externalLinks = page.externalLinks.filter(link => {
      if (seen.has(link.url)) return true;
      if (seen.size >= MAX_EXTERNAL_LINKS_TOTAL) return false;
      seen.add(link.url);
      return true;
    });
  }
}

/**
 * A failing cache must never fail the crawl.
 * @template T
 * @param {() => T} fn
 * @return {T | null}
 */
function attempt(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * @typedef {{
 *   auditedUrl: string,
 *   pageLinks: string[],
 *   env?: NodeJS.ProcessEnv,
 *   fetchPage?: typeof safeFetchPrefix,
 *   fetchBytes?: typeof safeFetchBytes,
 *   fetchExternal?: typeof safeFetchPublicPrefix,
 *   collectSitemap?: typeof collectSitemapDocuments,
 *   cache?: {read: typeof readSnapshot, write: typeof writeSnapshot},
 *   now?: () => number,
 * }} CrawlInput
 */

/**
 * The crawl: the shared snapshot (from the cache or a fresh crawl) plus, for this audited page only, status
 * checks of its own links that the snapshot did not reach.
 * @param {CrawlInput} rawInput
 * @return {Promise<SiteCrawlArtifact>} Never rejects.
 */
async function crawlSite(rawInput) {
  const artifact = await crawlSnapshot(rawInput);
  if ((artifact.state !== 'crawled' && artifact.state !== 'cached') || !artifact.snapshot) {
    return artifact;
  }
  try {
    const input =
      rawInput && typeof rawInput === 'object' ? rawInput : /** @type {CrawlInput} */ ({});
    const env = input.env || process.env;
    const config = parseConfig(env);
    const fetchBytesRaw = input.fetchBytes || safeFetchBytes;
    const snapshot = artifact.snapshot;
    // The two checks are independent (the audited site, other sites), so they run side by side.
    const [linkChecks, externalChecks] = await Promise.all([
      config.linkChecks > 0
        ? checkAuditedLinks({
            snapshot,
            auditedUrl: artifact.auditedUrl,
            pageLinks: Array.isArray(input.pageLinks) ? input.pageLinks : [],
            limit: config.linkChecks,
            robotsMode: config.robots,
            fetchPage: input.fetchPage || safeFetchPrefix,
            fetchBytes: (url, options) => fetchBytesRaw(url, {...options, userAgent: USER_AGENT}),
            now: input.now || Date.now,
          }).catch(() => null)
        : null,
      config.externalChecks > 0
        ? checkAuditedExternalLinks({
            snapshot,
            auditedUrl: artifact.auditedUrl,
            limit: config.externalChecks,
            fetchPage: input.fetchExternal || safeFetchPublicPrefix,
            now: input.now || Date.now,
          }).catch(() => null)
        : null,
    ]);
    artifact.linkChecks = linkChecks;
    artifact.externalChecks = externalChecks;
  } catch {
    artifact.linkChecks = null;
    artifact.externalChecks = null;
  }
  return artifact;
}

/**
 * @param {CrawlSnapshot} snapshot
 * @param {string} auditedUrl
 * @return {CrawlPage | null} The audited page, when the crawl read it as HTML.
 */
function findAuditedPage(snapshot, auditedUrl) {
  const audited = normalizeUrl(auditedUrl);
  if (!audited) return null;
  return (
    snapshot.pages.find(
      p =>
        p.extraction === 'ok' &&
        (normalizeUrl(p.url) === audited || normalizeUrl(p.finalUrl) === audited)
    ) || null
  );
}

/**
 * Status checks of the external links on the audited page (other sites), through the strict fetch that refuses every
 * private address. See `external-link-checker.js` for the limits.
 * @param {{snapshot: CrawlSnapshot, auditedUrl: string, limit: number, fetchPage: typeof safeFetchPublicPrefix, now: () => number}} input
 * @return {Promise<{checked: import('./external-link-checker.js').ExternalCheck[], notChecked: number}>}
 */
async function checkAuditedExternalLinks({snapshot, auditedUrl, limit, fetchPage, now}) {
  const page = findAuditedPage(snapshot, auditedUrl);
  if (!page || !Array.isArray(page.externalLinks)) return {checked: [], notChecked: 0};
  return checkExternalLinks({links: page.externalLinks, limit, fetchPage, now});
}

/**
 * Status checks of the audited page's own links that the shared snapshot did not reach (the page cap, the depth
 * bound or a file link), so "a broken link on this page" is judged on all of its links, up to `limit`. Same origin
 * only (every link here came from the page and was already kept to the origin), robots.txt honoured, no bodies
 * read, redirects followed for the crawler's few rounds. Per run, not part of the shared cache, because which
 * page is audited differs from run to run.
 * @param {{
 *   snapshot: CrawlSnapshot, auditedUrl: string, pageLinks: string[], limit: number,
 *   robotsMode: 'honour' | 'ignore', fetchPage: typeof safeFetchPrefix,
 *   fetchBytes: typeof safeFetchBytes, now: () => number,
 * }} input
 * @return {Promise<{checked: import('./crawl-snapshot.js').LinkCheck[], notChecked: number}>}
 */
async function checkAuditedLinks({
  snapshot,
  auditedUrl,
  pageLinks,
  limit,
  robotsMode,
  fetchPage,
  fetchBytes,
  now,
}) {
  const audited = normalizeUrl(auditedUrl);
  const page = snapshot.pages.find(
    p =>
      p.extraction === 'ok' &&
      (normalizeUrl(p.url) === audited || normalizeUrl(p.finalUrl) === audited)
  );
  if (!audited || !page) return {checked: [], notChecked: 0};

  // Everything the snapshot already knows a status for, by every URL it was requested or ended on.
  const known = new Set([audited]);
  for (const p of snapshot.pages) {
    for (const url of [p.url, p.finalUrl, ...p.redirects.map(hop => hop.url)]) {
      const normal = normalizeUrl(url);
      if (normal) known.add(normal);
    }
  }
  const own = new Set([normalizeUrl(page.url), normalizeUrl(page.finalUrl)]);
  /** @type {string[]} */
  const targets = [];
  const seen = new Set();
  // The page's rel=next/prev targets are not in its link list (a <link> in the head), but a broken one matters as much.
  const pagination = page.pagination || {next: [], prev: []};
  for (const raw of [
    ...page.links.map(link => link.url),
    ...pageLinks,
    ...pagination.next,
    ...pagination.prev,
  ]) {
    const url = normalizeUrl(raw, audited);
    if (!url || seen.has(url) || known.has(url) || own.has(url)) continue;
    if (!sameOrigin(url, snapshot.origin)) continue;
    seen.add(url);
    targets.push(url);
  }
  if (targets.length === 0) return {checked: [], notChecked: 0};

  const robots = await loadRobots({origin: snapshot.origin, mode: robotsMode, fetchBytes});
  // robots.txt that cannot be read: nothing is requested (the crawler does not guess), nothing is claimed.
  if (robots.state === 'unavailable') return {checked: [], notChecked: targets.length};

  /** @type {import('./crawl-snapshot.js').LinkCheck[]} */
  const checked = [];
  /** @type {string[]} */
  const allowedTargets = [];
  for (const url of targets) {
    if (robots.allowed(url)) {
      allowedTargets.push(url);
    } else {
      checked.push({url, finalUrl: url, status: null, redirects: [], state: 'blocked-by-robots'});
    }
  }
  const selected = allowedTargets.slice(0, limit);
  let notChecked = allowedTargets.length - selected.length;
  const fetched = await fetchPages({
    seeds: selected.map(url => ({url, source: /** @type {const} */ ('link'), depth: 1})),
    origin: snapshot.origin,
    allowed: robots.allowed,
    requestCap: Math.max(1, selected.length) * REQUEST_CAP_FACTOR,
    visited: new Set(),
    deadline: now() + LINK_CHECK_BUDGET_MS,
    fetchPage,
    skips: createSkips(),
    now,
    maxBytes: LINK_CHECK_MAX_BYTES,
    // Two checked links may redirect to the same place: each is followed to its end (the redirect rounds and the
    // request cap still bound it, and a loop shows up as a repeated URL in the hops).
    followVisited: true,
  });
  for (const result of fetched.pages) {
    checked.push({
      url: result.url,
      finalUrl: result.finalUrl,
      status: result.status,
      redirects: result.redirects,
      state: 'checked',
    });
  }
  notChecked += selected.length - fetched.pages.length;
  return {checked, notChecked};
}

/**
 * The shared snapshot, from the cache or a fresh crawl.
 * @param {CrawlInput} rawInput
 * @return {Promise<SiteCrawlArtifact>} Never rejects.
 */
async function crawlSnapshot(rawInput) {
  const input =
    rawInput && typeof rawInput === 'object' ? rawInput : /** @type {typeof rawInput} */ ({});
  const {
    auditedUrl,
    pageLinks,
    env = process.env,
    fetchPage = safeFetchPrefix,
    fetchBytes: fetchBytesRaw = safeFetchBytes,
    collectSitemap = collectSitemapDocuments,
    cache = {read: readSnapshot, write: writeSnapshot},
    now = Date.now,
  } = input;
  // robots.txt and the sitemap files identify the crawler the same way its page requests do.
  /** @type {typeof safeFetchBytes} */
  const fetchBytes = (url, options) => fetchBytesRaw(url, {...options, userAgent: USER_AGENT});
  /** @type {(over: Partial<SiteCrawlArtifact>) => SiteCrawlArtifact} */
  const artifact = over => ({
    state: 'unavailable',
    auditedUrl,
    reason: null,
    snapshot: null,
    auditedRenderedTextLength: null,
    linkChecks: null,
    externalChecks: null,
    ...over,
  });

  try {
    const config = parseConfig(env);
    if (!config.enabled) {
      return artifact({state: 'disabled', reason: 'the crawl is switched off (LHCI_SEO_CRAWL)'});
    }
    const audited = normalizeUrl(auditedUrl);
    if (!audited) return artifact({reason: 'the audited URL is not an http(s) URL'});
    const origin = new URL(audited).origin;

    const cacheSettings = resolveCacheSettings(env);
    const key = cacheKey({
      origin,
      pages: config.pages,
      depth: config.depth,
      robots: config.robots,
      userAgent: USER_AGENT,
    });
    const started = now();

    if (cacheSettings.dir) {
      const dir = cacheSettings.dir;
      const cached = attempt(() => cache.read(dir, key, {ttlMs: cacheSettings.ttlMs, now}));
      if (cached) {
        return topUpCached({cached, audited, auditedUrl, origin, fetchPage, now, artifact});
      }
    }

    const robots = await loadRobots({origin, mode: config.robots, fetchBytes});
    const skips = createSkips();

    // Seeds: the audited page, the homepage, the page's own links, then the sitemap's URLs; anything off the
    // origin or that robots.txt disallows is recorded and never requested.
    /** @param {string[]} raw @param {string} base */
    const sameOriginAllowed = (raw, base) => {
      /** @type {string[]} */
      const keep = [];
      for (const href of raw) {
        const url = normalizeUrl(href, base);
        if (!url) continue;
        if (!sameOrigin(url, origin)) skips.add(url, 'cross-origin', null);
        else if (url !== audited && !robots.allowed(url)) skips.add(url, 'blocked-by-robots', null);
        else keep.push(url);
      }
      return keep;
    };

    /** @type {string[]} */
    let links = [];
    /** @type {string[]} */
    let sitemapUrls = [];
    /** @type {string[]} */
    let sitemapListed = [];
    /** @type {string | null} */
    let home = null;
    if (robots.state !== 'unavailable') {
      links = sameOriginAllowed(pageLinks, audited);
      const rawSitemap = await loadSitemapUrls({
        auditedUrl: audited,
        collectSitemap,
        fetchBytes,
        env,
        now,
      });
      sitemapListed = unique(
        rawSitemap
          .map(href => normalizeUrl(href, audited))
          .filter(/** @return {url is string} */ url => url !== null && sameOrigin(url, origin))
      );
      sitemapUrls = sameOriginAllowed(rawSitemap, audited);
      const homeUrl = normalizeUrl('/', origin);
      if (homeUrl && homeUrl !== audited) {
        if (robots.allowed(homeUrl)) home = homeUrl;
        else skips.add(homeUrl, 'blocked-by-robots', 'the homepage');
      }
    }
    const seeds = selectSeeds({audited, home, links, sitemapUrls, pages: config.pages});
    const chosen = new Set(seeds.map(seed => seed.url));
    // Seed candidates that did not get a seed slot are not lost: the page's own links are found again by
    // the link-following below, and the leftover sitemap URLs fill any slots it leaves spare.
    const leftoverLinks = links.filter(url => !chosen.has(url));
    const leftoverSitemap = sitemapUrls.filter(
      url => !chosen.has(url) && !leftoverLinks.includes(url)
    );

    const crawl = await crawlLevels({
      seeds: seeds.map(seed => ({...seed, depth: seed.source === 'link' ? 1 : 0})),
      leftoverLinks,
      leftoverSitemap,
      origin,
      allowed: robots.allowed,
      config,
      started,
      fetchPage,
      skips,
      now,
      follow: robots.state !== 'unavailable',
    });
    if (robots.state === 'unavailable') {
      skips.add(
        origin,
        'blocked-by-robots',
        `robots.txt could not be read (${robots.reason}), so only the audited page was requested`
      );
    }
    limitExternalLinks(crawl.pages);

    /** @type {CrawlSnapshot} */
    const snapshot = {
      version: SNAPSHOT_VERSION,
      origin,
      createdAt: new Date(now()).toISOString(),
      bounds: {
        pages: config.pages,
        depth: config.depth,
        budgetMs: config.budgetMs,
        robots: config.robots,
        userAgent: USER_AGENT,
      },
      robots: {state: robots.state},
      seeds: {
        audited: 1,
        home: seeds.filter(seed => seed.source === 'home').length,
        links: seeds.filter(seed => seed.source === 'link').length,
        sitemap: seeds.filter(seed => seed.source === 'sitemap').length,
      },
      sitemapUrls: sitemapListed,
      pages: crawl.pages,
      skipped: skips.finish(),
      stats: {
        requests: crawl.requests + (config.robots === 'honour' ? 1 : 0),
        elapsedMs: Math.max(0, now() - started),
        truncatedByBudget: crawl.truncatedByBudget,
        overPageCap: crawl.overPageCap,
        cutByDepth: crawl.cutByDepth,
      },
    };
    const fetched = crawl;

    const answered = snapshot.pages.filter(page => page.status !== null);
    if (answered.length === 0) {
      return artifact({
        reason: fetched.firstError
          ? `no page could be requested: ${fetched.firstError}`
          : 'no page could be requested',
        snapshot,
      });
    }
    // A snapshot made while robots.txt was unreadable holds only the audited page, which would starve every
    // other run of the same collect; it is not cached.
    if (cacheSettings.dir && robots.state !== 'unavailable') {
      const dir = cacheSettings.dir;
      attempt(() => cache.write(dir, key, snapshot));
    }
    return artifact({state: 'crawled', snapshot});
  } catch (err) {
    return artifact({reason: `the crawl failed: ${messageOf(err)}`});
  }
}

/**
 * A cache hit that does not contain the audited page (another URL of the same collect) gets that one page
 * requested and added, so every audit can rely on the audited page being present.
 * @param {{
 *   cached: CrawlSnapshot, audited: string, auditedUrl: string, origin: string,
 *   fetchPage: typeof safeFetchPrefix, now: () => number,
 *   artifact: (over: Partial<SiteCrawlArtifact>) => SiteCrawlArtifact,
 * }} input
 * @return {Promise<SiteCrawlArtifact>}
 */
async function topUpCached({cached, audited, origin, fetchPage, now, artifact}) {
  const has = cached.pages.some(page => page.url === audited || page.finalUrl === audited);
  if (has) return artifact({state: 'cached', snapshot: cached});

  const skips = createSkips();
  const fetched = await fetchPages({
    seeds: [{url: audited, source: 'audited', depth: 0}],
    origin,
    allowed: () => true,
    requestCap: REQUEST_CAP_FACTOR,
    visited: new Set(),
    deadline: now() + SINGLE_PAGE_BUDGET_MS,
    fetchPage,
    skips,
    now,
  });
  const snapshot = {
    ...cached,
    pages: [...fetched.pages, ...cached.pages],
    stats: {...cached.stats, requests: cached.stats.requests + fetched.requests},
  };
  return artifact({state: 'cached', snapshot});
}

export {crawlSite, parseConfig};
