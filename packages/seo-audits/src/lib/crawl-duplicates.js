/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `duplicate-titles` and `duplicate-descriptions` audits: does another
 * crawled page share the audited page's title (or meta description)? Reads the site crawl's snapshot, so
 * it judges only the pages the crawl reached (see `crawl-coverage`). No I/O, never throws.
 *
 * Rules, chosen with the developer: values match when equal after trimming and case-folding (nothing
 * fuzzier); an empty value never counts (that is the core `document-title` / `meta-description` audits'
 * job); the audit fails when at least one other crawled page shares the audited page's value. Pairs that share a
 * value on purpose are skipped (and counted): a page whose canonical names another URL (a duplicate that is not
 * indexed in its own right), and two pages that are members of a rel=next / rel=prev series ("Blog - Page 2").
 */

import {normalizeUrl} from './crawl-snapshot.js';

import {Audit} from 'lighthouse/core/audits/audit.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {'title' | 'description'} DuplicateField */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const LABEL = {title: 'title', description: 'meta description'};

/**
 * @param {string} text
 * @param {number} [max]
 * @return {string}
 */
function clip(text, max = MAX_CELL_CHARS) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

/**
 * @param {string | null | undefined} value
 * @return {string} The comparison key; empty for a missing or blank value.
 */
function keyOf(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * @param {CrawlPage} page
 * @return {boolean} Whether the page names another URL as its canonical.
 */
function canonicalisedElsewhere(page) {
  if (!Array.isArray(page.canonicals) || page.canonicals.length !== 1) return false;
  const own = normalizeUrl(page.finalUrl || page.url);
  const named = normalizeUrl(page.canonicals[0], page.finalUrl || page.url);
  return !!own && !!named && own !== named;
}

/**
 * @param {CrawlPage} page
 * @return {boolean}
 */
function inSeries(page) {
  const p = page.pagination;
  return !!p && ((p.next && p.next.length > 0) || (p.prev && p.prev.length > 0));
}

/**
 * @param {CrawlPage} audited
 * @param {CrawlPage} other
 * @return {boolean} Whether the two pages share a value on purpose.
 */
function sharesOnPurpose(audited, other) {
  return (
    canonicalisedElsewhere(audited) ||
    canonicalisedElsewhere(other) ||
    (inSeries(audited) && inSeries(other))
  );
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @param {DuplicateField} field
 * @return {Product}
 */
function buildDuplicateProduct(artifact, field) {
  const label = LABEL[field];
  const snapshot = artifact && typeof artifact === 'object' ? artifact.snapshot : null;
  if (!artifact || typeof artifact !== 'object') {
    return {score: 1, notApplicable: true, explanation: 'The site crawl was not collected.'};
  }
  if (artifact.state === 'disabled' || artifact.state === 'unavailable') {
    return {
      score: 1,
      notApplicable: true,
      explanation: artifact.reason || 'The site crawl did not run.',
    };
  }
  if (!snapshot || !Array.isArray(snapshot.pages)) {
    return {score: 1, notApplicable: true, explanation: 'The site crawl could not run.'};
  }

  const audited = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  if (!audited) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'The crawler did not receive the audited page as HTML, so it was not compared.',
    };
  }
  const key = keyOf(audited[field]);
  if (!key) {
    return {
      score: 1,
      notApplicable: true,
      explanation: `The audited page has no ${label}; a missing one is reported by Lighthouse's own SEO audits.`,
    };
  }

  // Judge each final URL once: two requested URLs that redirect to one page are one page.
  const seen = new Set([audited.finalUrl]);
  /** @type {CrawlPage[]} */
  const others = [];
  let skippedOnPurpose = 0;
  for (const page of snapshot.pages) {
    if (page === audited || page.extraction !== 'ok' || seen.has(page.finalUrl)) continue;
    seen.add(page.finalUrl);
    if (keyOf(page[field]) !== key) continue;
    if (sharesOnPurpose(audited, page)) skippedOnPurpose++;
    else others.push(page);
  }
  const compared = seen.size;
  if (compared < 2) {
    return {
      score: 1,
      notApplicable: true,
      explanation: `The crawl reached no other page to compare the ${label} with.`,
    };
  }
  if (others.length === 0) {
    return {
      score: 1,
      displayValue: `Unique among ${compared} crawled pages${
        skippedOnPurpose
          ? ` (${skippedOnPurpose} sharing it on purpose: canonicalised or paginated)`
          : ''
      }`,
    };
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'url', valueType: 'text', label: 'Page sharing the audited page’s ' + label},
    {key: 'value', valueType: 'text', label: 'Shared ' + label},
  ];
  const shown = others.slice(0, MAX_ROWS);
  const items = shown.map(p => ({
    url: clip(p.finalUrl || p.url),
    value: clip(/** @type {string} */ (p[field]), 100),
  }));
  if (others.length > shown.length) {
    items.push({url: `${others.length - shown.length} more not shown`, value: ''});
  }
  return {
    score: 0,
    numericValue: others.length,
    numericUnit: 'unitless',
    displayValue: `${others.length} other ${
      others.length === 1 ? 'page shares' : 'pages share'
    } it`,
    explanation:
      `${others.length} other crawled ${
        others.length === 1 ? 'page has' : 'pages have'
      } the same ${label} as the audited page (compared among ${compared} crawled pages, ignoring case and surrounding spaces). ` +
      'Give each page its own, or point duplicates at one canonical URL.',
    details: Audit.makeTableDetails(headings, items),
  };
}

export {buildDuplicateProduct, keyOf, MAX_ROWS};
