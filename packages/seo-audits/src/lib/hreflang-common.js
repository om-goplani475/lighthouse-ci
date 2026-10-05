/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared pieces of the hreflang result builders: the not-applicable gate, table building, and finding which
 * of the page's own hreflang entries name the page itself. No I/O, never throws.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {looseKey} from './url-key.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/hreflang-data.js').HreflangDataArtifact} HreflangDataArtifact */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;

/**
 * @param {string} text
 * @param {number} [max]
 * @return {string}
 */
function clip(text, max = MAX_CELL_CHARS) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {Array<Record<string, string>>} rows
 * @param {Array<[string, string]>} columns [key, label]
 * @return {import('lighthouse/types/audit.js').default.Details.Table}
 */
function table(rows, columns) {
  const shown = rows.slice(0, MAX_ROWS);
  const items = [...shown];
  if (rows.length > shown.length) {
    /** @type {Record<string, string>} */
    const more = {};
    columns.forEach(
      ([key], i) => (more[key] = i === 0 ? `${rows.length - shown.length} more not shown` : '')
    );
    items.push(more);
  }
  return Audit.makeTableDetails(
    columns.map(([key, label]) => ({key, valueType: /** @type {const} */ ('text'), label})),
    items
  );
}

/**
 * @param {unknown} data
 * @return {Product | null} A not-applicable result when the page has no hreflang to judge, else null.
 */
function gate(data) {
  if (!data || typeof data !== 'object') {
    return notApplicable('The hreflang data was not collected.');
  }
  const alternates = /** @type {HreflangDataArtifact} */ (data).alternates;
  if (!Array.isArray(alternates) || alternates.length === 0) {
    return notApplicable('The page declares no hreflang links.');
  }
  return null;
}

/**
 * @param {HreflangDataArtifact} data
 * @return {string | null} The loose key of the page's own URL.
 */
function selfKeyOf(data) {
  return looseKey(data.pageUrl);
}

/**
 * The page's own entries: the hreflang links that name the page's URL, or its canonical.
 * @param {HreflangDataArtifact} data
 * @return {Array<{hreflang: string, href: string}>}
 */
function selfEntries(data) {
  const keys = new Set([looseKey(data.pageUrl), looseKey(data.canonical)].filter(Boolean));
  return data.alternates.filter(a => keys.has(looseKey(a.href)));
}

export {clip, notApplicable, table, gate, selfKeyOf, selfEntries, MAX_ROWS};
