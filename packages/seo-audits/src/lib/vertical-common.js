/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers shared by the vertical audits (e-commerce, local, news, video, entity): table and not-applicable products,
 * reading the site crawl safely, saying why the audited page could not be used, and comparing crawled pages with the
 * sitemap. No I/O, never throws.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {looseKey} from './url-key.js';

/** @typedef {import('./structured-facts.js').Entity} Entity */
/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;

/**
 * @param {CrawlPage} page
 * @return {boolean} Whether a crawled page is one worth judging: read as HTML, status 200, and not noindex.
 */
function isIndexablePage(page) {
  if (page.extraction !== 'ok' || page.status !== 200) return false;
  if (page.robotsMetas.some(m => /noindex|none/i.test(m.content))) return false;
  if (page.xRobotsTag.some(v => /noindex|none/i.test(v))) return false;
  return true;
}

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * @param {number} n
 * @param {string} noun
 * @return {string}
 */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {Array<{heading: string, key: string}>} columns
 * @param {Array<Record<string, string>>} rows
 * @return {import('lighthouse/types/audit.js').default.Details.Table}
 */
function table(columns, rows) {
  return Audit.makeTableDetails(
    columns.map(c => ({key: c.key, valueType: /** @type {const} */ ('text'), label: c.heading})),
    rows.slice(0, MAX_ROWS)
  );
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {{snapshot: NonNullable<SiteCrawlArtifact['snapshot']>} | {reason: string}}
 */
function usableSnapshot(artifact) {
  if (!artifact || !artifact.snapshot) {
    return {
      reason:
        artifact && artifact.state === 'disabled'
          ? 'The site crawl is switched off.'
          : 'The site crawl was not collected.',
    };
  }
  return {snapshot: artifact.snapshot};
}

/**
 * @param {NonNullable<SiteCrawlArtifact['snapshot']>} snapshot
 * @return {string | null} Why the audited page cannot be used to judge product markup, or null when it was read in full.
 */
function auditedPageProblem(snapshot) {
  const audited = snapshot.pages.find(p => p.source === 'audited');
  if (!audited) return 'The crawl did not include the audited page.';
  if (audited.extraction === 'error' || audited.status === null) {
    return 'The crawler could not fetch the audited page.';
  }
  if (!(audited.status >= 200 && audited.status < 300)) {
    return `The crawler got status ${audited.status} for the audited page (a site can answer a crawler differently from a browser), so its product markup was not read.`;
  }
  if (audited.extraction !== 'ok') return 'The crawler could not read the audited page as HTML.';
  if (audited.truncated) {
    return 'The crawler read only the start of the audited page (it is larger than the size cap), so markup near its end may be missing.';
  }
  return null;
}

/**
 * @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {{listed: Set<string>} | {reason: string}} The set of listed URLs, or why a "not listed" verdict cannot be trusted.
 */
function listedUrls(sitemaps) {
  if (!sitemaps || sitemaps.discovery === 'none' || sitemaps.discovery === 'unavailable') {
    return {reason: 'No sitemap was found, so there is nothing to compare with.'};
  }
  if (sitemaps.documentsTruncated) {
    return {
      reason:
        'The sitemap has more files than were read, so a page missing from it cannot be proved.',
    };
  }
  const docs = sitemaps.documents || [];
  if (docs.some(d => d.outcome !== 'ok' || d.entriesTruncated || d.kind === 'invalid')) {
    return {
      reason:
        'A sitemap file could not be read in full, so a page missing from it cannot be proved.',
    };
  }
  /** @type {Set<string>} */
  const listed = new Set();
  for (const d of docs) {
    if (d.kind !== 'urlset') continue;
    for (const loc of d.locs) {
      const key = looseKey(loc);
      if (key) listed.add(key);
    }
  }
  return listed.size ? {listed} : {reason: 'The sitemap lists no URLs.'};
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps
 * @param {(page: CrawlPage) => boolean} isTarget Which crawled pages are the ones that should be listed.
 * @param {string} noun For messages, for example "product".
 * @return {Product}
 */
function sitemapCoverageProduct(artifact, sitemaps, isTarget, noun) {
  const usable = usableSnapshot(artifact);
  if (!('snapshot' in usable)) return notApplicable(usable.reason);
  const targets = usable.snapshot.pages.filter(isTarget);
  if (targets.length === 0) {
    const problem = auditedPageProblem(usable.snapshot);
    return notApplicable(problem || `The crawl found no ${noun} pages.`);
  }
  const listed = listedUrls(sitemaps);
  if (!('listed' in listed)) return notApplicable(listed.reason);
  const audited = usable.snapshot.pages.find(p => p.source === 'audited');
  const missing = targets.filter(
    p => !listed.listed.has(looseKey(p.finalUrl) || '') && !listed.listed.has(looseKey(p.url) || '')
  );
  if (missing.length === 0) {
    return {score: 1, displayValue: `${count(targets.length, `${noun} page`)} listed`};
  }
  const auditedMissing = !!audited && missing.includes(audited);
  /** @type {Product} */
  const product = {
    // As the other cross-page audits: the audited page is what is judged; the rest are listed.
    score: auditedMissing ? 0.5 : 1,
    displayValue: `${missing.length} of ${targets.length} ${noun} pages not listed`,
    details: table(
      [
        {key: 'url', heading: 'Page'},
        {key: 'note', heading: 'Note'},
      ],
      missing.map(p => ({url: clip(p.finalUrl), note: p === audited ? 'The audited page' : ''}))
    ),
  };
  if (auditedMissing) {
    product.explanation = `This ${noun} page is not in any sitemap. Sitemaps help crawlers find and recrawl pages; list every page you want indexed.`;
  } else {
    product.explanation = `${missing.length} other crawled ${noun} page${
      missing.length === 1 ? ' is' : 's are'
    } not in any sitemap (listed below, not judged). The audited page is listed.`;
  }
  return product;
}

export {
  MAX_ROWS,
  MAX_CELL_CHARS,
  clip,
  count,
  notApplicable,
  table,
  usableSnapshot,
  auditedPageProblem,
  listedUrls,
  sitemapCoverageProduct,
  isIndexablePage,
};
