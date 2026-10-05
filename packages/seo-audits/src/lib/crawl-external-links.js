/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for `broken-external-links`: which of the external links on the audited page are gone?
 * It reads the page the crawl stored and the status checks made of its external links
 * (`external-link-checker.js`). No request, no I/O, never throws.
 *
 * Rules, chosen with the developer:
 *   - broken (fails): the final answer is 404 or 410, or the host does not exist (DNS) or refuses the connection;
 *   - unreliable (listed, never fails): a 5xx, a timeout, a reset, a TLS error, too many redirects: other people's
 *     sites have bad moments, and this audit must not flap on them;
 *   - ignored (counted, not listed as a problem): 401, 403, 429, 999 and the other 4xx, which mostly mean "this site
 *     blocks link checkers", and a link refused because it points at a private address;
 *   - only the audited page's own external links are judged, up to the configured number, at most two per host.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {MAX_EXTERNAL_LINKS_PER_PAGE} from './crawl-snapshot.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./external-link-checker.js').ExternalCheck} ExternalCheck */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {'ok' | 'broken' | 'unreliable' | 'ignored'} Verdict */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const GONE = new Set([404, 410]);
const UNREACHABLE = new Set(['ENOTFOUND', 'ECONNREFUSED']);
const ERROR_TEXT = {
  ENOTFOUND: 'host not found',
  ECONNREFUSED: 'connection refused',
  TIMEOUT: 'timed out',
  ETIMEDOUT: 'timed out',
  ECONNRESET: 'connection reset',
  EAI_AGAIN: 'temporary DNS failure',
  TLS: 'TLS or certificate error',
  TOO_MANY_REDIRECTS: 'too many redirects',
  PRIVATE: 'points at a private address, not requested',
  OTHER: 'request failed',
};

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * @param {number} n
 * @param {string} noun
 * @return {string}
 */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {ExternalCheck} check
 * @return {Verdict}
 */
function verdictOf(check) {
  if (check.error) {
    if (UNREACHABLE.has(check.error)) return 'broken';
    if (check.error === 'PRIVATE') return 'ignored';
    return 'unreliable';
  }
  const status = check.status;
  if (status === null) return 'unreliable';
  if (GONE.has(status)) return 'broken';
  // 500 to 599 are server errors; anything above (LinkedIn's 999, for one) is a site telling checkers to go away.
  if (status >= 600) return 'ignored';
  if (status >= 500) return 'unreliable';
  if (status >= 400) return 'ignored';
  if (status >= 300) return 'unreliable';
  return 'ok';
}

/**
 * @param {ExternalCheck} check
 * @return {string}
 */
function resultText(check) {
  if (check.error) {
    return /** @type {Record<string, string>} */ (ERROR_TEXT)[check.error] || check.error;
  }
  return check.status === null ? 'no answer' : `HTTP ${check.status}`;
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildBrokenExternalLinksProduct(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return notApplicable('The site crawl was not collected.');
  }
  if (artifact.state === 'disabled' || artifact.state === 'unavailable') {
    return notApplicable(artifact.reason || 'The site crawl did not run.');
  }
  const snapshot = artifact.snapshot;
  if (!snapshot || !Array.isArray(snapshot.pages)) {
    return notApplicable('The site crawl could not run.');
  }
  const audited = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  if (!audited) {
    return notApplicable(
      'The crawler did not receive the audited page as HTML, so its links were not read.'
    );
  }
  const links = Array.isArray(audited.externalLinks) ? audited.externalLinks : [];
  if (links.length === 0) {
    return notApplicable('The audited page has no links to other sites.');
  }
  const checks = artifact.externalChecks;
  if (!checks || !Array.isArray(checks.checked)) {
    return notApplicable(
      'External link checks are switched off (LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS=0) or did not run.'
    );
  }

  /** @type {Map<string, string>} */
  const anchors = new Map(links.map(link => [link.url, link.anchor]));
  const list = checks.checked.filter(c => c && typeof c === 'object');
  const broken = list.filter(c => verdictOf(c) === 'broken');
  const unreliable = list.filter(c => verdictOf(c) === 'unreliable');
  const privateTargets = list.filter(c => c.error === 'PRIVATE').length;
  const ignored = list.filter(c => verdictOf(c) === 'ignored').length - privateTargets;
  const fine = list.filter(c => verdictOf(c) === 'ok').length;
  const total = links.length;
  const more = total >= MAX_EXTERNAL_LINKS_PER_PAGE ? 'at least ' : '';
  const coverage = `${list.length} of ${more}${total} external links checked${
    checks.notChecked
      ? `, ${checks.notChecked} not checked (the per-host limit, the configured number or the time budget)`
      : ''
  }`;

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'link', valueType: 'text', label: 'External link'},
    {key: 'anchor', valueType: 'text', label: 'Anchor text'},
    {key: 'result', valueType: 'text', label: 'Result'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  /** @param {ExternalCheck} c @param {string} note */
  const row = (c, note) => ({
    link: clip(c.url),
    anchor: clip(anchors.get(c.url) || ''),
    result: resultText(c),
    note: [
      c.hops.length ? `after ${count(c.hops.length, 'redirect')} to ${clip(c.finalUrl)}` : '',
      note,
    ]
      .filter(Boolean)
      .join('; '),
  });
  const items = [
    ...broken.map(c => row(c, 'gone')),
    ...unreliable.map(c => row(c, 'unreliable, not failing: other sites have bad moments')),
  ];
  const shown = items.slice(0, MAX_ROWS);
  if (items.length > shown.length) {
    shown.push({
      link: `${items.length - shown.length} more not shown`,
      anchor: '',
      result: '',
      note: '',
    });
  }
  const tail = [
    unreliable.length
      ? `${count(unreliable.length, 'link')} did not answer reliably (listed, not judged)`
      : '',
    ignored
      ? `${count(ignored, 'link')} answered 401, 403, 429 or similar and were not judged`
      : '',
    privateTargets
      ? `${count(privateTargets, 'link')} point${
          privateTargets === 1 ? 's' : ''
        } at a private address and ${privateTargets === 1 ? 'was' : 'were'} not requested`
      : '',
  ]
    .filter(Boolean)
    .join('; ');
  if (broken.length === 0) {
    return {
      score: 1,
      displayValue: `No broken external links (${coverage})`,
      explanation: tail ? `${coverage}; ${tail}.` : undefined,
      details: shown.length || fine ? Audit.makeTableDetails(headings, shown) : undefined,
    };
  }
  return {
    score: 0,
    displayValue: `${count(broken.length, 'broken external link')} (${coverage})`,
    explanation: `${count(
      broken.length,
      'link'
    )} on the audited page point at another site where the page is gone (404 or 410) or the host does not exist or refuses connections. Remove or replace ${
      broken.length === 1 ? 'it' : 'them'
    }: visitors hit a dead end and the page looks neglected. ${coverage}${
      tail ? `; ${tail}` : ''
    }.`,
    details: Audit.makeTableDetails(headings, shown),
  };
}

export {buildBrokenExternalLinksProduct, verdictOf, MAX_ROWS};
