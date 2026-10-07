/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Writes run summaries as SARIF 2.1.0, the format GitHub code scanning (`github/codeql-action/upload-sarif`) and other
 * security and quality dashboards read. Pure: no I/O.
 *
 * Mapping (decisions of Phase 19):
 *   - One SARIF run holds every page. Each audit that raised an issue becomes a rule (id = the audit id); each issue on a
 *     page becomes one result (an audit that failed on two pages gives two results).
 *   - Level: a failing error-tier audit is `error`; anything else that is an issue (warn tier, or a partial score) is
 *     `warning`. Informational audits, passes and not-applicable audits are never results.
 *   - A page is not a file. The result's location is the page URL (an absolute `uri`) so any SARIF viewer shows which page.
 *     GitHub code scanning only shows alerts that point at a file in the repository, so `fileUri` can name one (for
 *     example the page's template or `lighthouserc.js`): the location is then that file at line 1, with the page URL kept
 *     in the message, a logical location and the result properties.
 *   - Each result carries a stable fingerprint (rule plus page), so an alert is the same alert from one run to the next.
 *   - Bounded: GitHub rejects more than 5,000 results per run, so at most 5,000 are written and the run says if it cut.
 */

import crypto from 'crypto';

/** @typedef {import('./run-summary.js').RunSummary} RunSummary */
/** @typedef {import('./run-summary.js').AuditResult} AuditResult */

const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA =
  'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';
const MAX_RESULTS = 5000;
const MAX_TEXT = 1000;
const FINGERPRINT_KEY = 'lhciSeoAudit/v1';

/**
 * @param {unknown} text
 * @param {number} [max]
 * @return {string}
 */
function clip(text, max = MAX_TEXT) {
  const flat = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}

/**
 * Whether `value` is a safe path inside a repository: relative, forward slashes, no `..`, no scheme, no control
 * characters. Used for `fileUri` so a caller cannot make the output point outside the repository.
 * @param {unknown} value
 * @return {value is string}
 */
function isRepoPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\?#%:*"<>|]/.test(value)) return false;
  if (value.startsWith('/')) return false;
  return value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/**
 * @param {AuditResult} issue
 * @return {'error' | 'warning'}
 */
function levelOf(issue) {
  return issue.status === 'fail' && issue.tier === 'error' ? 'error' : 'warning';
}

/**
 * @param {string} ruleId
 * @param {string} url
 * @return {string}
 */
function fingerprint(ruleId, url) {
  return crypto.createHash('sha256').update(`${ruleId}\n${url}`).digest('hex').slice(0, 32);
}

/**
 * @param {RunSummary[]} runs One summary per audited page.
 * @param {{toolVersion?: string, fileUri?: string | null}} [options]
 * @return {object} A SARIF 2.1.0 log, ready for JSON.stringify.
 * @throws {Error} When `fileUri` is not a safe repository path.
 */
function toSarif(runs, options = {}) {
  const {toolVersion = '0.0.0', fileUri = null} = options;
  if (fileUri !== null && !isRepoPath(fileUri)) {
    throw new Error(
      'fileUri must be a relative path inside the repository, without ".." or a scheme'
    );
  }

  /** @type {Map<string, {index: number, issue: AuditResult}>} */
  const rules = new Map();
  /** @type {object[]} */
  const results = [];
  const seen = new Set();
  let truncated = false;

  for (const run of runs) {
    for (const issue of run.issues) {
      const key = `${issue.id}\n${run.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (results.length >= MAX_RESULTS) {
        truncated = true;
        continue;
      }
      if (!rules.has(issue.id)) rules.set(issue.id, {index: rules.size, issue});
      const rule = /** @type {{index: number}} */ (rules.get(issue.id));
      const detail = [clip(issue.displayValue, 200), clip(issue.explanation)]
        .filter(Boolean)
        .join(' ');
      const message = clip(
        `${issue.title}${detail ? `: ${detail}` : ''}${fileUri ? ` (page: ${run.url})` : ''}`
      );
      results.push({
        ruleId: issue.id,
        ruleIndex: rule.index,
        level: levelOf(issue),
        message: {text: message},
        locations: [
          {
            physicalLocation: fileUri
              ? {artifactLocation: {uri: fileUri}, region: {startLine: 1}}
              : {artifactLocation: {uri: run.url}},
            logicalLocations: [{name: run.url, kind: 'resource'}],
          },
        ],
        partialFingerprints: {[FINGERPRINT_KEY]: fingerprint(issue.id, run.url)},
        properties: {url: run.url, category: issue.category, tier: issue.tier, score: issue.score},
      });
    }
  }

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'lhci-seo-audits',
            version: toolVersion,
            rules: [...rules.values()].map(({issue}) => ({
              id: issue.id,
              name: issue.id,
              shortDescription: {text: clip(issue.title, 200)},
              fullDescription: {text: clip(issue.description) || clip(issue.title)},
              help: {text: clip(issue.explanation || issue.description) || clip(issue.title)},
              defaultConfiguration: {level: issue.tier === 'error' ? 'error' : 'warning'},
              properties: {category: issue.category, tier: issue.tier},
            })),
          },
        },
        results,
        properties: {pages: runs.map(r => r.url), truncated},
      },
    ],
  };
}

export {toSarif, isRepoPath, SARIF_VERSION, MAX_RESULTS};
