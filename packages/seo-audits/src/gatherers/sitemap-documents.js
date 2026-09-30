/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Discovers, fetches and parses the page's XML sitemap(s) once per run, so the sitemap audits (and
 * later the URL-status sample and cross-checks) all read one artifact instead of each fetching the
 * same possibly multi-MB file.
 *
 * This is the first gatherer in this package that makes outbound requests, including to URLs
 * named by the audited site itself (robots.txt `Sitemap:` lines, which may point at another host).
 * Every request goes through `../lib/safe-fetch.js`'s `safeFetchBytes` (scheme allowlist,
 * private-IP blocking, DNS-rebinding-resistant lookup, no redirects, total timeout, byte cap); see
 * `.ai-agents/prompts/security-checklist.md`. The number of documents fetched per run is capped
 * (`LIMITS.MAX_DOCUMENTS`) for the same reason.
 *
 * Lighthouse core's `RobotsTxt` artifact cannot be used as a gatherer dependency here: only
 * gatherers that declare a `meta.symbol` (DevtoolsLog, Trace, Scripts, SourceMaps) can be
 * depended on. So robots.txt is fetched again, through the SSRF-protected path.
 *
 * Every per-document failure (HTTP error, redirect, network error, bad gzip, bad XML) is recorded
 * as data on that document, never thrown: one broken sitemap must not hide the others' results.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {safeFetchBytes, safeFetchPrefix} from '../lib/safe-fetch.js';
import {parseRobotsTxt} from '../lib/robots-txt.js';
import {LIMITS, emptyDocument, parseSitemapBytes} from '../lib/sitemap-parse.js';
import {collectUrlSample} from '../lib/sitemap-url-sample.js';

/** @typedef {import('../lib/sitemap-parse.js').SitemapDocument} SitemapDocument */
/** @typedef {import('../lib/sitemap-parse.js').SitemapDocumentsArtifact} SitemapDocumentsArtifact */
/** @typedef {typeof safeFetchBytes} FetchBytes */

const ROBOTS_TIMEOUT_MS = 5_000;
const ROBOTS_MAX_BYTES = 1024 * 1024;

/**
 * Fetches one sitemap document and turns whatever happened into a `SitemapDocument`.
 * @param {FetchBytes} fetchBytes
 * @param {string} url
 * @param {SitemapDocument['source']} source
 * @param {string | null} parentUrl
 * @return {Promise<SitemapDocument>}
 */
async function fetchDocument(fetchBytes, url, source, parentUrl) {
  let response;
  try {
    response = await fetchBytes(url, {
      timeoutMs: LIMITS.REQUEST_TIMEOUT_MS,
      maxBytes: LIMITS.MAX_COMPRESSED_BYTES,
    });
  } catch (err) {
    const doc = emptyDocument({url, source, parentUrl});
    doc.outcome = 'network-error';
    doc.errorMessage = err instanceof Error ? err.message : String(err);
    return doc;
  }

  const {status, redirectLocation, body} = response;
  if (status >= 200 && status < 300) {
    return parseSitemapBytes({url, source, parentUrl, status, body});
  }

  const doc = emptyDocument({url, source, parentUrl});
  doc.status = status;
  doc.compressedBytes = body.length;
  if (status >= 300 && status < 400) {
    doc.outcome = 'redirect';
    doc.redirectLocation = redirectLocation;
  } else {
    doc.outcome = 'http-error';
  }
  return doc;
}

/**
 * Classifies a robots.txt fetch: `present` (with its text), `absent` (4xx: no robots.txt, so
 * crawlers fall back to defaults), or `unavailable` (5xx, a redirect we don't follow, or a network
 * failure: nothing can be concluded), with the reason so the run can say why it skipped.
 * @param {FetchBytes} fetchBytes
 * @param {string} robotsUrl
 * @return {Promise<{state: 'present', text: string} | {state: 'absent'} | {state: 'unavailable', reason: string}>}
 */
async function fetchRobots(fetchBytes, robotsUrl) {
  try {
    const {status, body} = await fetchBytes(robotsUrl, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: ROBOTS_MAX_BYTES,
    });
    if (status >= 200 && status < 300) return {state: 'present', text: body.toString('utf-8')};
    if (status >= 400 && status < 500) return {state: 'absent'};
    return {state: 'unavailable', reason: `${robotsUrl} returned HTTP ${status}`};
  } catch (err) {
    return {
      state: 'unavailable',
      reason: `${robotsUrl} could not be fetched: ${err instanceof Error ? err.message : err}`,
    };
  }
}

/**
 * The run warning for a skipped sitemap check, or null when nothing was skipped. Without it, the
 * three sitemap audits just show "not applicable" and nobody can tell a site that has no sitemap
 * from a fetch that was refused (a localhost or private-network page, without the opt-in).
 * @param {SitemapDocumentsArtifact} artifact
 * @return {string | null}
 */
function skippedWarning(artifact) {
  if (artifact.discovery !== 'unavailable' || !artifact.unavailableReason) return null;
  return `Sitemap audits were skipped: ${artifact.unavailableReason}`;
}

/**
 * @param {string} value
 * @return {boolean}
 */
function isAbsoluteHttpUrl(value) {
  try {
    const {protocol} = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Follows each root sitemap *index* exactly one level: its child sitemaps are fetched
 * breadth-first (roots in order, each root's children in order) until `LIMITS.MAX_DOCUMENTS`
 * documents exist in total. A child that is itself an index is recorded but its own children are
 * not fetched. Only children whose `<loc>` passed validation are ever requested, and a URL already
 * fetched is not requested twice. Running out of budget sets `documentsTruncated`, so a partial
 * check is never presented as a complete one.
 * @param {FetchBytes} fetchBytes
 * @param {SitemapDocumentsArtifact} artifact Mutated: children are appended to `documents`.
 * @return {Promise<void>}
 */
async function followIndexes(fetchBytes, artifact) {
  const roots = artifact.documents.filter(
    doc => doc.outcome === 'ok' && doc.kind === 'sitemapindex'
  );
  const seen = new Set(artifact.documents.map(doc => doc.url));

  for (const root of roots) {
    for (const childUrl of root.locs) {
      if (seen.has(childUrl)) continue;
      if (artifact.documents.length >= LIMITS.MAX_DOCUMENTS) {
        artifact.documentsTruncated = true;
        return;
      }
      seen.add(childUrl);
      artifact.documents.push(await fetchDocument(fetchBytes, childUrl, 'index-child', root.url));
    }
  }
}

/**
 * Discovery and the sitemap documents themselves; the page sample is added by the caller.
 * @param {{finalDisplayedUrl: string}} url
 * @param {FetchBytes} fetchBytes
 * @return {Promise<SitemapDocumentsArtifact>}
 */
async function collectDocuments(url, fetchBytes) {
  const origin = new URL(url.finalDisplayedUrl).origin;

  /** @type {SitemapDocumentsArtifact} */
  const artifact = {
    discovery: 'unavailable',
    unavailableReason: null,
    ignoredSitemapLines: [],
    documentsTruncated: false,
    documents: [],
    urlSample: null,
  };

  const robots = await fetchRobots(fetchBytes, `${origin}/robots.txt`);
  if (robots.state === 'unavailable') {
    artifact.unavailableReason = robots.reason;
    return artifact;
  }

  /** @type {string[]} */
  let declared = [];
  if (robots.state === 'present') {
    const {sitemaps} = parseRobotsTxt(robots.text);
    for (const value of sitemaps) {
      if (!isAbsoluteHttpUrl(value)) artifact.ignoredSitemapLines.push(value);
      else if (!declared.includes(value)) declared.push(value);
    }
    declared = declared.slice(0, LIMITS.MAX_DECLARED);
  }

  if (declared.length > 0) {
    artifact.discovery = 'robots-txt';
    for (const sitemapUrl of declared) {
      artifact.documents.push(await fetchDocument(fetchBytes, sitemapUrl, 'declared', null));
    }
    await followIndexes(fetchBytes, artifact);
    return artifact;
  }

  // Nothing declared: probe the default location. A 404/410 means "no sitemap" (item 1's
  // concern); any other failure means we can't tell.
  const probe = await fetchDocument(fetchBytes, `${origin}/sitemap.xml`, 'default-location', null);
  if (probe.status === 404 || probe.status === 410) {
    artifact.discovery = 'none';
  } else if (
    probe.outcome === 'http-error' ||
    probe.outcome === 'network-error' ||
    probe.outcome === 'redirect'
  ) {
    artifact.discovery = 'unavailable';
    artifact.unavailableReason =
      probe.outcome === 'redirect'
        ? `${probe.url} redirects to ${probe.redirectLocation}`
        : probe.errorMessage || `${probe.url} returned HTTP ${probe.status}`;
  } else {
    artifact.discovery = 'default-location';
    artifact.documents.push(probe);
    await followIndexes(fetchBytes, artifact);
  }
  return artifact;
}

/**
 * Discovers and fetches the site's sitemap(s), then requests a bounded sample of the URLs they list
 * (`urlSample`, see `../lib/sitemap-url-sample.js`): one request per sampled URL, whose status,
 * headers and head signals feed both `sitemap-url-status` and `sitemap-indexability`. The sample is
 * only taken when a sitemap was actually found (`robots-txt` or `default-location`), and is `null`
 * otherwise or when it lists no URL on its own origin.
 * @param {{finalDisplayedUrl: string}} url
 * @param {{
 *   fetchBytes?: FetchBytes,
 *   fetchPage?: typeof safeFetchPrefix,
 *   env?: NodeJS.ProcessEnv,
 *   now?: () => number,
 * }} [deps] Injectable so tests never touch the network; production always uses the
 *   SSRF-protected defaults.
 * @return {Promise<SitemapDocumentsArtifact>}
 */
async function collectSitemapDocuments(
  url,
  {fetchBytes = safeFetchBytes, fetchPage = safeFetchPrefix, env, now} = {}
) {
  const artifact = await collectDocuments(url, fetchBytes);
  if (artifact.discovery === 'robots-txt' || artifact.discovery === 'default-location') {
    artifact.urlSample = await collectUrlSample(artifact.documents, {fetchPage, env, now});
  }
  return artifact;
}

class SitemapDocuments extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<SitemapDocumentsArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const artifact = await collectSitemapDocuments(passContext.baseArtifacts.URL);
    const warning = skippedWarning(artifact);
    if (warning) passContext.baseArtifacts.LighthouseRunWarnings.push(warning);
    return artifact;
  }
}

export default SitemapDocuments;
export {collectSitemapDocuments, fetchDocument, skippedWarning};
