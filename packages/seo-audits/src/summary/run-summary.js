/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns one Lighthouse result (LHR) into a summary: a tier-weighted score per category and overall, and a ranked list
 * of issues. Pure: no I/O, never throws on a malformed result (it reports what it can read).
 *
 * Decisions (chosen with the developer, Phase 16):
 *   - The tier of an audit is the one in `recommended-assertions.json`: `error` or `warn`. An audit that file does not
 *     list (informational) is never scored and never an issue.
 *   - A category score is the weighted share of its applicable scored audits that pass: an error-tier audit weighs 3, a
 *     warn-tier audit 1, and an audit's partial score (0.5) counts as half. Not-applicable audits are left out. A category
 *     with nothing applicable has no score. The overall score is the same sum over all categories.
 *   - Issues are ranked by tier (error before warn), then by reach (how many items the audit found: its `numericValue`,
 *     else the rows of its table), then by id.
 */

import {CATEGORIES} from './categories.js';

/** @typedef {'error' | 'warn'} Tier */
/** @typedef {'pass' | 'warn' | 'fail' | 'na' | 'error'} Status */
/**
 * @typedef {{
 *   id: string, title: string, category: string, tier: Tier, status: Status, score: number | null, reach: number,
 *   displayValue: string, explanation: string, description: string,
 * }} AuditResult
 */
/** @typedef {{name: string, score: number | null, grade: string, applicable: number, passed: number, warnings: number, failures: number}} CategoryScore */
/**
 * @typedef {{
 *   url: string, fetchTime: string, lighthouseVersion: string, overall: CategoryScore, categories: CategoryScore[],
 *   issues: AuditResult[], audits: Map<string, AuditResult>, auditsFound: number, auditErrors: number,
 * }} RunSummary
 */

const WEIGHT = {error: 3, warn: 1};
const MAX_TEXT = 400;

/**
 * @param {number | null} score 0 to 100
 * @return {string}
 */
function gradeOf(score) {
  if (score === null) return '-';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * @param {unknown} text
 * @return {string}
 */
function clip(text) {
  const flat = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return flat.length <= MAX_TEXT ? flat : `${flat.slice(0, MAX_TEXT)}...`;
}

/**
 * @param {any} audit An LHR audit result.
 * @return {Status}
 */
function statusOf(audit) {
  if (!audit || typeof audit !== 'object') return 'na';
  if (audit.scoreDisplayMode === 'error') return 'error';
  if (typeof audit.score !== 'number' || !Number.isFinite(audit.score)) return 'na';
  if (audit.scoreDisplayMode === 'notApplicable' || audit.scoreDisplayMode === 'informative') {
    return 'na';
  }
  if (audit.score >= 1) return 'pass';
  return audit.score > 0 ? 'warn' : 'fail';
}

/**
 * The text of the first table row, for an audit that has no display value or explanation of its own.
 * @param {any} audit
 * @return {string}
 */
function firstRowText(audit) {
  const items = audit.details && Array.isArray(audit.details.items) ? audit.details.items : [];
  const row = items.find((/** @type {any} */ r) => r && typeof r === 'object');
  if (!row) return '';
  for (const key of ['message', 'problem', 'result', 'detail', 'note', 'conflict']) {
    if (typeof row[key] === 'string' && row[key].trim()) return clip(row[key]);
  }
  const first = Object.values(row).find(v => typeof v === 'string' && v.trim());
  return typeof first === 'string' ? clip(first) : '';
}

/**
 * How many things the audit found: its numeric value when it has one, else the rows of its table (a "more not shown"
 * row is not counted), else 1.
 * @param {any} audit
 * @return {number}
 */
function reachOf(audit) {
  if (typeof audit.numericValue === 'number' && Number.isFinite(audit.numericValue)) {
    return Math.max(1, Math.round(audit.numericValue));
  }
  const items = audit.details && Array.isArray(audit.details.items) ? audit.details.items : [];
  const real = items.filter(
    (/** @type {any} */ row) =>
      !(
        row &&
        typeof row === 'object' &&
        Object.values(row).some(v => /more not shown/.test(String(v)))
      )
  );
  return Math.max(1, real.length);
}

/**
 * @param {number} earned
 * @param {number} total
 * @return {number | null}
 */
function percent(earned, total) {
  return total > 0 ? Math.round((earned / total) * 1000) / 10 : null;
}

/**
 * @param {any} input A Lighthouse result.
 * @param {Record<string, [string, unknown]>} recommended The recommended assertions: audit id to [level, options].
 * @param {Array<{name: string, audits: string[]}>} [categories]
 * @return {RunSummary}
 */
function summarizeRun(input, recommended, categories = CATEGORIES) {
  const lhr = input && typeof input === 'object' ? input : {};
  const audits = typeof lhr.audits === 'object' && lhr.audits ? lhr.audits : {};
  /** @type {Map<string, string>} */
  const categoryByAudit = new Map();
  for (const c of categories) for (const id of c.audits) categoryByAudit.set(id, c.name);
  /** @type {Map<string, AuditResult>} */
  const results = new Map();
  let auditErrors = 0;
  for (const [id, level] of Object.entries(recommended)) {
    const raw = audits[id];
    if (!raw) continue;
    const status = statusOf(raw);
    if (status === 'error') auditErrors++;
    results.set(id, {
      id,
      title: clip(raw.title) || id,
      category: categoryByAudit.get(id) || 'Other',
      tier: level[0] === 'error' ? 'error' : 'warn',
      status,
      score: typeof raw.score === 'number' ? raw.score : null,
      reach: reachOf(raw),
      displayValue: clip(raw.displayValue) || firstRowText(raw),
      explanation: clip(raw.explanation),
      description: clip(raw.description),
    });
  }

  /** @param {string} name @param {AuditResult[]} members @return {CategoryScore} */
  const scoreOf = (name, members) => {
    let earned = 0;
    let total = 0;
    let passed = 0;
    let warnings = 0;
    let failures = 0;
    for (const r of members) {
      if (r.status === 'na' || r.status === 'error' || r.score === null) continue;
      const weight = WEIGHT[r.tier];
      total += weight;
      earned += weight * r.score;
      if (r.status === 'pass') passed++;
      else if (r.status === 'warn') warnings++;
      else failures++;
    }
    const score = percent(earned, total);
    return {
      name,
      score,
      grade: gradeOf(score),
      applicable: passed + warnings + failures,
      passed,
      warnings,
      failures,
    };
  };

  const all = [...results.values()];
  const byCategory = categories.map(c =>
    scoreOf(
      c.name,
      all.filter(r => r.category === c.name)
    )
  );
  const issues = all
    .filter(r => r.status === 'fail' || r.status === 'warn')
    .sort((a, b) =>
      a.tier !== b.tier
        ? a.tier === 'error'
          ? -1
          : 1
        : b.reach - a.reach || a.id.localeCompare(b.id)
    );
  return {
    url: String(lhr.finalDisplayedUrl || lhr.finalUrl || lhr.requestedUrl || ''),
    fetchTime: String(lhr.fetchTime || ''),
    lighthouseVersion: String(lhr.lighthouseVersion || ''),
    overall: scoreOf('Overall', all),
    categories: byCategory,
    issues,
    audits: results,
    auditsFound: results.size,
    auditErrors,
  };
}

export {summarizeRun, gradeOf, statusOf, reachOf, WEIGHT};
