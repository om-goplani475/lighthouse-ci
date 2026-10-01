/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure logic for the transport-security audits (mixed content, HSTS, certificate expiry): no I/O, no
 * artifacts, nothing that imports `import.meta`, so every rule below is unit-testable. The audit files
 * only resolve inputs (see transport-security-sources.js) and call the functions here.
 *
 * Mixed content: Chrome's own account of what it blocked, auto-upgraded or allowed (core's
 * `InspectorIssues`), merged with the `http:` requests the page actually made. Active content (scripts,
 * stylesheets, frames, fetch/XHR, fonts, forms...) fails; passive content (images, audio, video) is
 * reported as a note unless the browser blocked it.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/**
 * @typedef {'active' | 'passive'} MixedKind
 * @typedef {'blocked' | 'auto-upgraded' | 'allowed'} MixedResolution
 * @typedef {{url: string, type: string, kind: MixedKind, resolution: MixedResolution}} MixedContentItem
 * @typedef {{items: MixedContentItem[], failing: number, notes: number}} MixedContentResult
 * @typedef {{resourceType?: string, resolutionStatus: string, insecureURL: string}} MixedContentIssue
 * @typedef {{url: string, resourceType: string}} InsecureRecord
 * @typedef {{directive: string, value: string | null, finding: string, severity: 'problem' | 'note'}} HstsFinding
 * @typedef {{
 *   present: boolean,
 *   headerCount: number,
 *   maxAge: number | null,
 *   includeSubDomains: boolean,
 *   preload: boolean,
 *   findings: HstsFinding[],
 *   passes: boolean,
 * }} HstsResult
 * @typedef {{
 *   subject: string | null,
 *   issuer: string | null,
 *   validFrom: number,
 *   validTo: number,
 *   daysRemaining: number,
 *   state: 'expired' | 'not-yet-valid' | 'expiring-soon' | 'ok',
 * }} CertificateResult
 * @typedef {import('lighthouse/types/audit.js').default.Product} Product
 */

const HSTS_MIN_MAX_AGE = 31_536_000;
const CERT_WARN_DAYS = 15;
const MAX_ROWS = 50;

// Lowercased type names from both vocabularies we read: CDP's MixedContentResourceType (issues) and
// CDP's Network.ResourceType (records). Everything not listed here is treated as active, the safe
// direction: an unfamiliar type is flagged rather than quietly waved through.
const PASSIVE_TYPES = new Set([
  'image',
  'audio',
  'video',
  'media',
  'track',
  'texttrack',
  'favicon',
  'plugindata',
  'pluginresource',
]);

/** @type {Record<string, MixedResolution>} */
const RESOLUTIONS = {
  MixedContentBlocked: 'blocked',
  MixedContentAutomaticallyUpgraded: 'auto-upgraded',
  MixedContentWarning: 'allowed',
};

/**
 * @param {string} type
 * @return {MixedKind}
 */
function kindOf(type) {
  return PASSIVE_TYPES.has(type.toLowerCase()) ? 'passive' : 'active';
}

/**
 * @param {string} pageUrl
 * @return {boolean}
 */
function isHttpsUrl(pageUrl) {
  try {
    return new URL(pageUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * @param {{issues: MixedContentIssue[], records: InsecureRecord[], pageUrl: string}} input
 * @return {MixedContentResult | null} Null when the page is not served over https: mixed content
 *   only exists on an https page.
 */
function classifyMixedContent({issues, records, pageUrl}) {
  if (!isHttpsUrl(pageUrl)) return null;

  /** @type {Map<string, MixedContentItem>} */
  const byUrl = new Map();

  // Chrome's own account first: it knows what it did with the request, so it wins over a record.
  for (const issue of issues) {
    if (!issue.insecureURL || issue.insecureURL.startsWith('data:')) continue;
    const type = issue.resourceType || 'Unknown';
    byUrl.set(issue.insecureURL, {
      url: issue.insecureURL,
      type,
      kind: kindOf(type),
      resolution: RESOLUTIONS[issue.resolutionStatus] || 'allowed',
    });
  }
  for (const record of records) {
    if (byUrl.has(record.url) || !record.url.startsWith('http:')) continue;
    const type = record.resourceType || 'Unknown';
    byUrl.set(record.url, {url: record.url, type, kind: kindOf(type), resolution: 'allowed'});
  }

  const items = [...byUrl.values()].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'active' ? -1 : 1) ||
      (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)
  );
  const failing = items.filter(
    item => item.kind === 'active' || item.resolution === 'blocked'
  ).length;
  return {items, failing, notes: items.length - failing};
}

/**
 * @param {MixedContentItem} item
 * @return {string}
 */
function impactOf(item) {
  const what = item.kind === 'active' ? 'resource' : 'image or media file';
  if (item.resolution === 'blocked') {
    return `Blocked by the browser: this ${what} did not load, so whatever depends on it is broken.`;
  }
  if (item.resolution === 'auto-upgraded') {
    return `Chrome upgraded it to https:// for this load, but the source still says http://. Change the URL.`;
  }
  return item.kind === 'active'
    ? 'Loaded over http:// on an https page. An attacker on the network can alter it and take over the page, and some browsers block it. Change the URL.'
    : 'Loaded over http:// on an https page, with a browser warning. An attacker on the network could swap it. Change the URL.';
}

/**
 * @param {MixedContentResult | null} result
 * @return {Product}
 */
function mixedContentProduct(result) {
  if (!result) return {score: 1, notApplicable: true};
  if (!result.items.length) return {score: 1};

  const shown = result.items.slice(0, MAX_ROWS);
  const rows = shown.map(item => ({
    url: item.url,
    type: item.type,
    kind: item.kind === 'active' ? 'Active' : 'Passive',
    resolution:
      item.resolution === 'blocked'
        ? 'Blocked'
        : item.resolution === 'auto-upgraded'
        ? 'Auto-upgraded'
        : 'Allowed',
    impact: impactOf(item),
  }));
  const hidden = result.items.length - shown.length;
  if (hidden > 0) {
    rows.push({url: `${hidden} more not shown`, type: '', kind: '', resolution: '', impact: ''});
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'url', valueType: 'text', label: 'Insecure URL'},
    {key: 'type', valueType: 'text', label: 'Type'},
    {key: 'kind', valueType: 'text', label: 'Kind'},
    {key: 'resolution', valueType: 'text', label: 'Browser'},
    {key: 'impact', valueType: 'text', label: 'What it means'},
  ];
  const total = result.items.length;
  /** @type {Product} */
  const product = {
    score: result.failing > 0 ? 0 : 1,
    displayValue: total === 1 ? '1 insecure resource' : `${total} insecure resources`,
    details: Audit.makeTableDetails(headings, rows),
  };
  if (result.failing > 0) {
    product.explanation = `${result.failing} active or blocked insecure resource(s) found during this load.`;
  }
  return product;
}

export {classifyMixedContent, mixedContentProduct, HSTS_MIN_MAX_AGE, CERT_WARN_DAYS, MAX_ROWS};
