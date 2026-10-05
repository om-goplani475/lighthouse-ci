/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared pieces of the content result builders: table building, the not-applicable result, and the check that
 * the page content was collected. No I/O, never throws.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/page-content.js').PageContentArtifact} PageContentArtifact */

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
 * @param {unknown} content
 * @return {content is PageContentArtifact}
 */
function hasContent(content) {
  return (
    !!content &&
    typeof content === 'object' &&
    typeof (/** @type {any} */ (content).text) === 'string'
  );
}

export {clip, notApplicable, table, hasContent, MAX_ROWS};
