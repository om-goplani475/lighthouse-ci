/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compares two run summaries of the same page (an earlier and a later one): which issues are new, which are fixed,
 * which are still there, and how the scores moved. Pure: no I/O.
 */

import {looseKey} from '../lib/url-key.js';

/** @typedef {import('./run-summary.js').RunSummary} RunSummary */
/** @typedef {import('./run-summary.js').AuditResult} AuditResult */

/**
 * @typedef {{
 *   url: string,
 *   overallBefore: number | null, overallAfter: number | null, overallDelta: number | null,
 *   categories: Array<{name: string, before: number | null, after: number | null, delta: number | null}>,
 *   newIssues: AuditResult[], fixed: AuditResult[], stillFailing: AuditResult[],
 *   worse: Array<{audit: AuditResult, before: number}>, better: Array<{audit: AuditResult, before: number}>,
 * }} RunComparison
 */

/**
 * @param {AuditResult | undefined} r
 * @return {boolean} Whether the audit counts as a problem.
 */
function isIssue(r) {
  return !!r && (r.status === 'fail' || r.status === 'warn');
}

/**
 * @param {number | null} before
 * @param {number | null} after
 * @return {number | null}
 */
function delta(before, after) {
  return before === null || after === null ? null : Math.round((after - before) * 10) / 10;
}

/**
 * @param {RunSummary} before
 * @param {RunSummary} after
 * @return {RunComparison}
 */
function compareRuns(before, after) {
  /** @type {AuditResult[]} */
  const newIssues = [];
  /** @type {AuditResult[]} */
  const fixed = [];
  /** @type {AuditResult[]} */
  const stillFailing = [];
  /** @type {Array<{audit: AuditResult, before: number}>} */
  const worse = [];
  /** @type {Array<{audit: AuditResult, before: number}>} */
  const better = [];
  const ids = new Set([...before.audits.keys(), ...after.audits.keys()]);
  for (const id of ids) {
    const was = before.audits.get(id);
    const now = after.audits.get(id);
    if (isIssue(now) && !isIssue(was)) newIssues.push(/** @type {AuditResult} */ (now));
    else if (isIssue(was) && now && !isIssue(now)) fixed.push(/** @type {AuditResult} */ (was));
    else if (isIssue(now) && isIssue(was)) {
      stillFailing.push(/** @type {AuditResult} */ (now));
      const a = /** @type {number} */ (was && was.score);
      const b = /** @type {number} */ (now && now.score);
      if (b < a) worse.push({audit: /** @type {AuditResult} */ (now), before: a});
      else if (b > a) better.push({audit: /** @type {AuditResult} */ (now), before: a});
    }
  }
  const rank = (/** @type {AuditResult} */ a, /** @type {AuditResult} */ b) =>
    a.tier !== b.tier
      ? a.tier === 'error'
        ? -1
        : 1
      : b.reach - a.reach || a.id.localeCompare(b.id);
  newIssues.sort(rank);
  fixed.sort(rank);
  stillFailing.sort(rank);
  return {
    url: after.url || before.url,
    overallBefore: before.overall.score,
    overallAfter: after.overall.score,
    overallDelta: delta(before.overall.score, after.overall.score),
    categories: after.categories.map(c => {
      const old = before.categories.find(x => x.name === c.name);
      const b = old ? old.score : null;
      return {name: c.name, before: b, after: c.score, delta: delta(b, c.score)};
    }),
    newIssues,
    fixed,
    stillFailing,
    worse,
    better,
  };
}

/**
 * Pairs the runs of two reports by page, then compares each pair.
 * @param {RunSummary[]} before
 * @param {RunSummary[]} after
 * @return {{comparisons: Map<string, RunComparison>, onlyInBefore: string[], onlyInAfter: string[]}}
 */
function compareAll(before, after) {
  /** @type {Map<string, RunSummary>} */
  const earlier = new Map(before.map(r => [looseKey(r.url) || r.url, r]));
  /** @type {Map<string, RunComparison>} */
  const comparisons = new Map();
  /** @type {string[]} */
  const onlyInAfter = [];
  for (const run of after) {
    const key = looseKey(run.url) || run.url;
    const old = earlier.get(key);
    if (old) {
      comparisons.set(run.url, compareRuns(old, run));
      earlier.delete(key);
    } else {
      onlyInAfter.push(run.url);
    }
  }
  return {comparisons, onlyInBefore: [...earlier.values()].map(r => r.url), onlyInAfter};
}

export {compareRuns, compareAll, isIssue};
