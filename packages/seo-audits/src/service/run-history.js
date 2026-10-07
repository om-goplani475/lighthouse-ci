/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * History of a project's finished runs: a chronological series of scores per page, a CSV of it, and a comparison of any
 * two stored runs. Pure: no I/O, never throws on a damaged stored result (a run it cannot read is left out).
 */

import {reviveRun} from './run-result.js';
import {compareRuns} from '../summary/compare.js';

const MAX_POINTS = 200;

/**
 * @typedef {{id: string, url: string, branch: string | null, sha: string | null, trigger: string | null, createdAt: string | Date, summary: any}} StoredRun
 * @typedef {{
 *   runId: string, at: string, url: string, path: string, branch: string | null, sha: string | null, trigger: string | null,
 *   score: number | null, grade: string, failures: number, warnings: number,
 *   categories: Array<{name: string, score: number | null}>,
 * }} HistoryPoint
 */

/**
 * @param {string} url
 * @return {string | null} The path without a trailing slash (a preview host changes per pull request, so pages are matched by path).
 */
function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/(.)\/+$/, '$1');
  } catch (_) {
    return null;
  }
}

/**
 * @param {unknown} value
 * @return {number | null}
 */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {StoredRun[]} runs Finished runs, in any order.
 * @param {{path?: string | null, branch?: string | null, limit?: number}} [filter]
 * @return {{points: HistoryPoint[], pages: Array<{path: string, runs: number}>}} `points` oldest first, at most `limit`
 *   (the newest ones); `pages` lists every page seen, before filtering by page, with how many runs it has.
 */
function buildHistory(runs, filter = {}) {
  const limit = Math.min(Math.max(1, Math.floor(filter.limit || MAX_POINTS)), MAX_POINTS);
  /** @type {HistoryPoint[]} */
  const all = [];
  for (const run of runs) {
    const s = run && run.summary;
    const path = pathOf(run && run.url);
    if (!s || !s.overall || !Array.isArray(s.categories) || path === null) continue;
    const at = new Date(run.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    all.push({
      runId: run.id,
      at: at.toISOString(),
      url: run.url,
      path,
      branch: run.branch || null,
      sha: run.sha || null,
      trigger: run.trigger || null,
      score: numberOrNull(s.overall.score),
      grade: typeof s.overall.grade === 'string' ? s.overall.grade : '-',
      failures: numberOrNull(s.overall.failures) || 0,
      warnings: numberOrNull(s.overall.warnings) || 0,
      categories: s.categories
        .filter((/** @type {any} */ c) => c && typeof c.name === 'string')
        .map((/** @type {any} */ c) => ({name: c.name, score: numberOrNull(c.score)})),
    });
  }
  all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.runId.localeCompare(b.runId)));

  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const p of all) {
    if (filter.branch && p.branch !== filter.branch) continue;
    counts.set(p.path, (counts.get(p.path) || 0) + 1);
  }
  const pages = [...counts.entries()]
    .map(([path, n]) => ({path, runs: n}))
    .sort((a, b) => b.runs - a.runs || a.path.localeCompare(b.path));

  const points = all
    .filter(
      p =>
        (!filter.path || p.path === filter.path) && (!filter.branch || p.branch === filter.branch)
    )
    .slice(-limit);
  return {points, pages};
}

/**
 * A spreadsheet treats a cell that starts with `=`, `+`, `-`, `@` (or a tab or carriage return) as a formula, and a page
 * address or a branch name is chosen by someone else; such a cell is prefixed with an apostrophe.
 * @param {unknown} value
 * @return {string}
 */
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {HistoryPoint[]} points
 * @return {string} CSV with one row per run and one column per category (the union over all runs, in first-seen order).
 */
function historyToCsv(points) {
  /** @type {string[]} */
  const names = [];
  for (const p of points) {
    for (const c of p.categories) if (!names.includes(c.name)) names.push(c.name);
  }
  const header = [
    'run',
    'time',
    'url',
    'branch',
    'commit',
    'trigger',
    'score',
    'grade',
    'failures',
    'warnings',
    ...names,
  ];
  const rows = points.map(p => {
    const byName = new Map(p.categories.map(c => [c.name, c.score]));
    return [
      p.runId,
      p.at,
      p.url,
      p.branch,
      p.sha,
      p.trigger,
      p.score,
      p.grade,
      p.failures,
      p.warnings,
      ...names.map(n => byName.get(n)),
    ];
  });
  return `${[header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * @param {unknown} storedBefore The stored `summary` of the earlier run.
 * @param {unknown} storedAfter The stored `summary` of the later run.
 * @return {ReturnType<typeof compareRuns> | null} Null when either run cannot be read.
 */
function compareStored(storedBefore, storedAfter) {
  const before = reviveRun(storedBefore);
  const after = reviveRun(storedAfter);
  return before && after ? compareRuns(before, after) : null;
}

export {buildHistory, historyToCsv, compareStored, csvCell, pathOf, MAX_POINTS};
