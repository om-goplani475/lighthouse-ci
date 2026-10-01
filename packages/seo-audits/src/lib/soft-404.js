/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure logic for the soft-404 check: no I/O. A soft 404 is a page for a URL that does not exist that
 * answers 200 (or redirects to a normal page, the "unknown URLs bounce to the homepage" pattern
 * Google reports as a soft 404) instead of 404/410. The gatherer requests two made-up URLs on the
 * audited origin and this file decides what each answer means and builds the audit result.
 *
 * Deliberately narrow: this detects a site that answers made-up URLs with a normal page, which is how
 * almost every soft 404 happens (a catch-all route or a single-page app answering every path). It does
 * not look at the content of real pages for "not found" wording; that needs many pages and waits for
 * the crawler (docs/phases/phase-5-crawlability.md).
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/**
 * @typedef {'not-found' | 'other-4xx' | 'soft-404' | 'redirect-to-page' | 'redirect-to-error' |
 *   'redirect-chain' | 'redirect-elsewhere' | 'redirect-unresolvable' | 'server-error' |
 *   'unexpected-status' | 'failed'} ProbeOutcome
 * @typedef {{
 *   shape: 'top-level' | 'nested-file',
 *   url: string,
 *   status: number | null,
 *   location: string | null,
 *   targetStatus: number | null,
 *   outcome: ProbeOutcome,
 *   reason: string | null,
 * }} Probe
 * @typedef {{origin: string, probes: Probe[], unavailableReason: string | null}} Soft404Artifact
 * @typedef {import('lighthouse/types/audit.js').default.Product} Product
 */

// Text the audited site controls (a redirect's Location) reaches the report, so it is cut to a fixed
// length, as in transport-security.js.
const MAX_TEXT_CHARS = 1_000;

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_TEXT_CHARS)}... (${text.length - MAX_TEXT_CHARS} more characters)`;
}

/**
 * The two made-up URLs. Two shapes because some servers and single-page apps answer only one shape
 * with a catch-all (a top-level path, or a file-like path under a made-up directory).
 * @param {string} origin
 * @param {string} token Random, so the URL is certain not to exist and cannot be cached.
 * @return {Array<{shape: Probe['shape'], url: string}>}
 */
function probeUrls(origin, token) {
  return [
    {shape: 'top-level', url: `${origin}/lhci-seo-probe-${token}`},
    {shape: 'nested-file', url: `${origin}/lhci-seo-probe-${token}/page.html`},
  ];
}

/**
 * What the first response to a made-up URL means, and whether a redirect should be followed once.
 * A redirect is followed only when it stays on the same origin; one that leaves the site is never
 * requested, so a hostile Location cannot aim a request anywhere.
 * @param {string} probeUrl
 * @param {number} status
 * @param {string | null | undefined} location
 * @return {{outcome: ProbeOutcome, reason: string | null, follow: string | null,
 *   location: string | null}}
 */
function classifyFirstResponse(probeUrl, status, location) {
  const none = {reason: null, follow: null, location: null};
  if (status >= 200 && status < 300) return {...none, outcome: 'soft-404'};
  if (status === 404 || status === 410) return {...none, outcome: 'not-found'};
  if (status >= 400 && status < 500) return {...none, outcome: 'other-4xx'};
  if (status >= 500 && status < 600) return {...none, outcome: 'server-error'};
  if (status < 300 || status >= 400) return {...none, outcome: 'unexpected-status'};

  if (!location) {
    return {...none, outcome: 'redirect-unresolvable', reason: 'no Location header'};
  }
  let target;
  try {
    target = new URL(location, probeUrl);
  } catch {
    return {
      ...none,
      outcome: 'redirect-unresolvable',
      reason: 'the Location is not a valid URL',
      location: clip(location),
    };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return {
      ...none,
      outcome: 'redirect-unresolvable',
      reason: `the Location uses the "${target.protocol}" scheme`,
      location: clip(location),
    };
  }
  if (target.origin !== new URL(probeUrl).origin) {
    return {...none, outcome: 'redirect-elsewhere', location: clip(target.href)};
  }
  return {
    outcome: 'redirect-chain',
    reason: null,
    follow: target.href,
    location: clip(target.href),
  };
}

/**
 * @param {number} targetStatus The status of the same-origin page a redirect led to.
 * @return {ProbeOutcome}
 */
function classifyRedirectTarget(targetStatus) {
  if (targetStatus >= 200 && targetStatus < 300) return 'redirect-to-page';
  if (targetStatus >= 300 && targetStatus < 400) return 'redirect-chain';
  if (targetStatus >= 400 && targetStatus < 500) return 'redirect-to-error';
  if (targetStatus >= 500 && targetStatus < 600) return 'server-error';
  return 'unexpected-status';
}

/** @type {ProbeOutcome[]} */
const FAILING = ['soft-404', 'redirect-to-page'];

/**
 * @param {Probe} probe
 * @return {string}
 */
function describeProbe(probe) {
  const {status, location, targetStatus, reason} = probe;
  switch (probe.outcome) {
    case 'soft-404':
      return `Returned HTTP ${status}: a URL that does not exist is served as a normal page (a "soft 404").`;
    case 'redirect-to-page':
      return `Redirects to ${location}, which returns HTTP ${targetStatus}: unknown URLs end up on a normal page (a "soft 404").`;
    case 'not-found':
      return `Returned HTTP ${status} (correct).`;
    case 'other-4xx':
      return `Returned HTTP ${status} (an error status, so not a soft 404).`;
    case 'redirect-to-error':
      return `Redirects to ${location}, which returns HTTP ${targetStatus} (an error status, so not a soft 404).`;
    case 'redirect-chain':
      return `Redirects to ${location}, which redirects again (not followed further, so not judged).`;
    case 'redirect-elsewhere':
      return `Redirects to a different origin (${location}); not followed, so not judged.`;
    case 'redirect-unresolvable':
      return `Redirects, but ${reason}; not judged.`;
    case 'server-error':
      return `Returned HTTP ${
        targetStatus ?? status
      }: not a soft 404, but a URL that does not exist should return 404.`;
    case 'unexpected-status':
      return `Returned HTTP ${status ?? targetStatus}; not judged.`;
    default:
      return `Could not be requested: ${reason}.`;
  }
}

/**
 * @param {Soft404Artifact | null | undefined} artifact
 * @return {Product}
 */
function soft404Product(artifact) {
  if (!artifact || !Array.isArray(artifact.probes) || !artifact.probes.length) {
    return {score: 1, notApplicable: true, explanation: 'The soft-404 probe was not collected.'};
  }
  const judged = artifact.probes.filter(p => p.outcome !== 'failed');
  if (!judged.length) {
    return {
      score: 1,
      notApplicable: true,
      explanation:
        artifact.unavailableReason ||
        'Neither made-up URL could be requested, so the site was not checked.',
    };
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'probe', valueType: 'text', label: 'Made-up URL'},
    {key: 'url', valueType: 'text', label: 'URL'},
    {key: 'result', valueType: 'text', label: 'What the site did'},
  ];
  const rows = artifact.probes.map(p => ({
    probe: p.shape === 'top-level' ? 'Top-level path' : 'Nested .html path',
    url: p.url,
    result: describeProbe(p),
  }));
  const details = Audit.makeTableDetails(headings, rows);

  const failing = artifact.probes.filter(p => FAILING.includes(p.outcome));
  if (failing.length) {
    return {
      score: 0,
      explanation:
        `${failing.length} of ${artifact.probes.length} made-up URL(s) were answered as a normal ` +
        'page instead of 404 or 410 (a soft 404): search engines can index endless junk URLs.',
      details,
    };
  }
  return {score: 1, details};
}

export {probeUrls, classifyFirstResponse, classifyRedirectTarget, describeProbe, soft404Product};
