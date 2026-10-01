/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The bounded site crawl: fetches the audited page, its own internal links and the sitemap's URLs (depth 1:
 * the links of those pages are stored, not followed) and reduces each page to a snapshot entry
 * (`crawl-extract.js`). Never throws: every failure is data in the returned artifact.
 *
 * Bounds, all constants or clamped environment variables (never settable by the audited page): at most
 * `LHCI_SEO_CRAWL_MAX_PAGES` pages (default 50), 5 requests at a time, 5 s per request with one retry for a
 * network error, a 512 KiB body per page, redirects followed for at most 3 rounds and only within the
 * origin, a request cap of 3 x pages, and a total budget (`LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS`, default
 * 120 s) after which what is left is recorded as not checked.
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
import {safeFetchPrefix, safeFetchBytes} from './safe-fetch.js';
import {checkUrls, pickEvenly, REQUEST_TIMEOUT_MS} from './sitemap-url-sample.js';
import {collectSitemapDocuments} from '../gatherers/sitemap-documents.js';
import {extractPage} from './crawl-extract.js';
import {
  cacheKey,
  normalizeUrl,
  sameOrigin,
  selectSeeds,
  MAX_BODY_BYTES,
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
 * @return {{enabled: boolean, pages: number, budgetMs: number, robots: 'honour' | 'ignore'}}
 */
function parseConfig(env) {
  return {
    enabled: !isOff(env.LHCI_SEO_CRAWL),
    pages: clampedInt(env.LHCI_SEO_CRAWL_MAX_PAGES, DEFAULT_PAGES, 1, MAX_PAGES),
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
 * Requests the seeds, following same-origin redirects for a few rounds, and turns every checked URL into a
 * page entry. Shared by the full crawl and by the single-page top-up of a cached snapshot.
 * @param {{
 *   seeds: Array<{url: string, source: 'audited' | 'link' | 'sitemap'}>,
 *   origin: string,
 *   allowed: (url: string) => boolean,
 *   pages: number,
 *   deadline: number,
 *   fetchPage: typeof safeFetchPrefix,
 *   skips: ReturnType<typeof createSkips>,
 *   now: () => number,
 * }} input
 * @return {Promise<{pages: CrawlPage[], requests: number, truncatedByBudget: boolean, firstError: string | null}>}
 */
async function fetchPages({seeds, origin, allowed, pages, deadline, fetchPage, skips, now}) {
  const requestCap = pages * REQUEST_CAP_FACTOR;
  /** @type {Array<{source: 'audited' | 'link' | 'sitemap', url: string, current: string, hops: CrawlHop[], check: UrlCheck | null}>} */
  const entries = seeds.map(seed => ({
    source: seed.source,
    url: seed.url,
    current: seed.url,
    hops: [],
    check: null,
  }));
  const visited = new Set(seeds.map(seed => seed.url));
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
            maxBytes: MAX_BODY_BYTES,
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
        truncatedByBudget = true;
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
      } else if (visited.has(target)) {
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
    if (!entry.check) continue;
    out.push(toPage(entry));
  }
  return {pages: out, requests, truncatedByBudget, firstError};
}

/**
 * @param {{source: 'audited' | 'link' | 'sitemap', url: string, current: string, hops: CrawlHop[], check: UrlCheck | null}} entry
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
 * @param {{
 *   auditedUrl: string,
 *   pageLinks: string[],
 *   env?: NodeJS.ProcessEnv,
 *   fetchPage?: typeof safeFetchPrefix,
 *   fetchBytes?: typeof safeFetchBytes,
 *   collectSitemap?: typeof collectSitemapDocuments,
 *   cache?: {read: typeof readSnapshot, write: typeof writeSnapshot},
 *   now?: () => number,
 * }} rawInput
 * @return {Promise<SiteCrawlArtifact>} Never rejects.
 */
async function crawlSite(rawInput) {
  const input =
    rawInput && typeof rawInput === 'object' ? rawInput : /** @type {typeof rawInput} */ ({});
  const {
    auditedUrl,
    pageLinks,
    env = process.env,
    fetchPage = safeFetchPrefix,
    fetchBytes = safeFetchBytes,
    collectSitemap = collectSitemapDocuments,
    cache = {read: readSnapshot, write: writeSnapshot},
    now = Date.now,
  } = input;
  /** @type {(over: Partial<SiteCrawlArtifact>) => SiteCrawlArtifact} */
  const artifact = over => ({
    state: 'unavailable',
    auditedUrl,
    reason: null,
    snapshot: null,
    auditedRenderedTextLength: null,
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

    // Seeds: the page's own links, then the sitemap's URLs; anything off the origin or that robots.txt
    // disallows is recorded and never requested.
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
    if (robots.state !== 'unavailable') {
      links = sameOriginAllowed(pageLinks, audited);
      sitemapUrls = sameOriginAllowed(
        await loadSitemapUrls({auditedUrl: audited, collectSitemap, fetchBytes, env, now}),
        audited
      );
    }
    const seeds = selectSeeds({audited, links, sitemapUrls, pages: config.pages});
    const chosen = new Set(seeds.map(seed => seed.url));
    for (const url of [...links, ...sitemapUrls]) {
      if (!chosen.has(url)) skips.add(url, 'over-page-cap', null);
    }

    const fetched = await fetchPages({
      seeds,
      origin,
      allowed: robots.allowed,
      pages: config.pages,
      deadline: started + config.budgetMs,
      fetchPage,
      skips,
      now,
    });
    if (robots.state === 'unavailable') {
      skips.add(
        origin,
        'blocked-by-robots',
        `robots.txt could not be read (${robots.reason}), so only the audited page was requested`
      );
    }

    /** @type {CrawlSnapshot} */
    const snapshot = {
      version: SNAPSHOT_VERSION,
      origin,
      createdAt: new Date(now()).toISOString(),
      bounds: {
        pages: config.pages,
        budgetMs: config.budgetMs,
        robots: config.robots,
        userAgent: USER_AGENT,
      },
      robots: {state: robots.state},
      seeds: {
        audited: 1,
        links: seeds.filter(seed => seed.source === 'link').length,
        sitemap: seeds.filter(seed => seed.source === 'sitemap').length,
      },
      pages: fetched.pages,
      skipped: skips.finish(),
      stats: {
        requests: fetched.requests + (config.robots === 'honour' ? 1 : 0),
        elapsedMs: Math.max(0, now() - started),
        truncatedByBudget: fetched.truncatedByBudget,
      },
    };

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
    seeds: [{url: audited, source: 'audited'}],
    origin,
    allowed: () => true,
    pages: 1,
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
