/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns a run summary into plain data for the database and back, so a later run can be compared with it. The stored form
 * keeps every audit result (about 60 small rows) and drops what can be derived (the ranked issue list).
 */

import {isIssue} from '../summary/compare.js';

/** @typedef {import('../summary/run-summary.js').RunSummary} RunSummary */
/** @typedef {import('../summary/run-summary.js').AuditResult} AuditResult */

const STATUSES = new Set(['pass', 'warn', 'fail', 'na', 'error']);

/**
 * @param {RunSummary} summary
 * @return {object} Plain data, ready for JSON.stringify.
 */
function serializeRun(summary) {
  return {
    url: summary.url,
    fetchTime: summary.fetchTime,
    lighthouseVersion: summary.lighthouseVersion,
    overall: summary.overall,
    categories: summary.categories,
    auditErrors: summary.auditErrors,
    audits: [...summary.audits.values()],
  };
}

/**
 * @param {any} a
 * @return {boolean}
 */
function isAuditResult(a) {
  return (
    !!a &&
    typeof a.id === 'string' &&
    (a.tier === 'error' || a.tier === 'warn') &&
    STATUSES.has(a.status) &&
    typeof a.reach === 'number'
  );
}

/**
 * @param {any} data A value made by `serializeRun`, possibly read back from the database.
 * @return {RunSummary | null} Null when the data is not a usable run (a missing or damaged baseline is "no baseline").
 */
function reviveRun(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.audits)) return null;
  if (!data.overall || typeof data.overall !== 'object' || !Array.isArray(data.categories)) {
    return null;
  }
  /** @type {Map<string, AuditResult>} */
  const audits = new Map();
  for (const a of data.audits) if (isAuditResult(a)) audits.set(a.id, a);
  const all = [...audits.values()];
  const issues = all
    .filter(isIssue)
    .sort((a, b) =>
      a.tier !== b.tier
        ? a.tier === 'error'
          ? -1
          : 1
        : b.reach - a.reach || a.id.localeCompare(b.id)
    );
  return {
    url: String(data.url || ''),
    fetchTime: String(data.fetchTime || ''),
    lighthouseVersion: String(data.lighthouseVersion || ''),
    overall: data.overall,
    categories: data.categories,
    issues,
    audits,
    auditsFound: audits.size,
    auditErrors: Number(data.auditErrors) || 0,
  };
}

export {serializeRun, reviveRun};
