/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The result builder for the informational `hreflang-sitemap-consistency` audit: does the sitemap list the same
 * alternates for the audited page as the page's own hreflang links? Reads the `<xhtml:link>` entries the
 * `SitemapDocuments` gatherer recorded for the audited URL (`targetEntry`); no request. Informational: a site may
 * legitimately use only one of the two places, so a difference is a note, never a failure. No I/O, never throws.
 */

import {looseKey} from './url-key.js';
import {clip, gate, notApplicable, table} from './hreflang-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/hreflang-data.js').HreflangDataArtifact} HreflangDataArtifact */

/**
 * @param {Array<{hreflang: string, href: string}>} alternates
 * @return {Map<string, {hreflang: string, href: string}>}
 */
function keyed(alternates) {
  /** @type {Map<string, {hreflang: string, href: string}>} */
  const map = new Map();
  for (const a of alternates) {
    const url = looseKey(a.href);
    if (url) map.set(`${a.hreflang.trim().toLowerCase()}\n${url}`, a);
  }
  return map;
}

/**
 * @param {unknown} data HreflangData
 * @param {any} sitemaps SitemapDocuments
 * @return {Product}
 */
function buildSitemapProduct(data, sitemaps) {
  const skip = gate(data);
  if (skip) return skip;
  const d = /** @type {HreflangDataArtifact} */ (data);
  const documents = sitemaps && Array.isArray(sitemaps.documents) ? sitemaps.documents : [];
  if (documents.length === 0) {
    return notApplicable(
      'No sitemap was found, so there is nothing to compare the page hreflang links with.'
    );
  }
  const entry = documents
    .map((/** @type {any} */ doc) => doc && doc.targetEntry)
    .find((/** @type {any} */ e) => e);
  if (!entry || !Array.isArray(entry.alternates)) {
    return {
      score: 1,
      displayValue: 'This page is not listed in the sitemap',
      details: table(
        [
          {
            note: 'The sitemap files that were read do not list this page, so its hreflang cannot be compared (a large sitemap may only be read in part).',
          },
        ],
        [['note', 'Note']]
      ),
    };
  }
  const inPage = keyed(d.alternates);
  const inSitemap = keyed(entry.alternates);
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  for (const [key, a] of inPage) {
    if (!inSitemap.has(key)) {
      rows.push({
        hreflang: a.hreflang,
        url: clip(a.href),
        result: 'in the page, not in the sitemap',
      });
    }
  }
  for (const [key, a] of inSitemap) {
    if (!inPage.has(key)) {
      rows.push({
        hreflang: a.hreflang,
        url: clip(a.href),
        result: 'in the sitemap, not in the page',
      });
    }
  }
  if (rows.length === 0) {
    return {
      score: 1,
      displayValue: `The sitemap and the page list the same ${inPage.size} alternates`,
    };
  }
  const truncated = entry.alternatesTruncated ? ' (the sitemap list was cut at 100 entries)' : '';
  return {
    score: 1,
    displayValue: `${rows.length} ${
      rows.length === 1 ? 'difference' : 'differences'
    } between the page and the sitemap${truncated}`,
    details: table(rows, [
      ['hreflang', 'hreflang'],
      ['url', 'Alternate URL'],
      ['result', 'Where'],
    ]),
  };
}

export {buildSitemapProduct};
