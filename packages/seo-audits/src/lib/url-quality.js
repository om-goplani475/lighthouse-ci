/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure logic for the per-URL quality audits (`url-length`, `url-query-parameters`,
 * `url-session-tracking`, `url-encoding`): string checks on a URL, no request. The audited page's own URL
 * is judged; the other URLs the site crawl reached are listed, never failed. These audits work even when
 * the crawl is switched off, because the audited URL is always known. No I/O, never throws.
 *
 * Rules, chosen with the developer and relaxed after review: more than 115 characters of path plus query is a note
 * (it fails only above 2,000), or more than 3 query
 * parameters, fails; a session ID in the URL fails; a tracking parameter is a note only; repeated slashes,
 * broken percent-encoding and double encoding fail.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{severity: 'fail' | 'note', detail: string}} UrlFinding */
/** @typedef {{id: string, subject: string, check: (url: URL) => UrlFinding[], passText: string, failText: string}} UrlRule */

const MAX_URL_LENGTH = 115;
// 115 is a readability convention, not a Google limit, so it is a note. Only an extreme length (browsers and
// servers start refusing URLs around here) fails.
const EXTREME_URL_LENGTH = 2000;
const MAX_PARAMS = 3;
const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;

// Names that are a session identifier whatever the value.
const SESSION_PARAMS = new Set([
  'phpsessid',
  'jsessionid',
  'sessionid',
  'session_id',
  'sessid',
  'aspsessionid',
  'cfid',
  'cftoken',
  'oscsid',
  'zenid',
]);
// Names too common to judge by name alone; counted only when the value looks like an identifier.
const AMBIGUOUS_SESSION_PARAMS = new Set(['sid', 'session', 's', 'token']);
const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  'igshid',
  'ttclid',
  'twclid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'mkt_tok',
]);

/**
 * @param {string} text
 * @param {number} [max]
 * @return {string}
 */
function clip(text, max = MAX_CELL_CHARS) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

/**
 * @param {string} name Query parameter name, any case.
 * @return {boolean}
 */
function isTrackingParam(name) {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING_PARAMS.has(n);
}

/**
 * @param {string} name
 * @param {string} value
 * @return {boolean}
 */
function isSessionParam(name, value) {
  const n = name.toLowerCase();
  if (SESSION_PARAMS.has(n) || n.startsWith('aspsessionid')) return true;
  return AMBIGUOUS_SESSION_PARAMS.has(n) && /^[a-z0-9._-]{16,}$/i.test(value);
}

/** @type {Record<string, UrlRule>} */
const RULES = {
  length: {
    id: 'length',
    subject: 'URL length',
    passText: 'is within the length limit',
    failText: 'is too long',
    check(url) {
      const length = url.pathname.length + url.search.length;
      if (length > EXTREME_URL_LENGTH) {
        return [
          {
            severity: 'fail',
            detail: `${length} characters of path and query (extreme: over ${EXTREME_URL_LENGTH})`,
          },
        ];
      }
      return length > MAX_URL_LENGTH
        ? [
            {
              severity: 'note',
              detail: `${length} characters of path and query (a note above ${MAX_URL_LENGTH})`,
            },
          ]
        : [];
    },
  },
  params: {
    id: 'params',
    subject: 'query parameters',
    passText: 'has few query parameters',
    failText: 'has too many query parameters',
    check(url) {
      const count = Array.from(url.searchParams.keys()).length;
      return count > MAX_PARAMS
        ? [{severity: 'fail', detail: `${count} query parameters (limit ${MAX_PARAMS})`}]
        : [];
    },
  },
  session: {
    id: 'session',
    subject: 'session and tracking parameters',
    passText: 'carries no session ID',
    failText: 'carries a session ID',
    check(url) {
      /** @type {UrlFinding[]} */
      const findings = [];
      /** @type {Set<string>} */
      const seen = new Set();
      for (const [name, value] of url.searchParams) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        if (isSessionParam(name, value)) {
          seen.add(key);
          findings.push({severity: 'fail', detail: `session ID in the query (${clip(name, 40)})`});
        } else if (isTrackingParam(name)) {
          seen.add(key);
          findings.push({
            severity: 'note',
            detail: `tracking parameter (${clip(name, 40)}), a note only`,
          });
        }
      }
      if (/;(jsessionid|phpsessid|sid)=/i.test(url.pathname)) {
        findings.push({severity: 'fail', detail: 'session ID in the path (;jsessionid=...)'});
      }
      return findings;
    },
  },
  encoding: {
    id: 'encoding',
    subject: 'URL encoding',
    passText: 'is cleanly encoded',
    failText: 'has an encoding or slash problem',
    check(url) {
      /** @type {UrlFinding[]} */
      const findings = [];
      if (/\/{2,}/.test(url.pathname)) {
        findings.push({severity: 'fail', detail: 'repeated slashes (//) in the path'});
      }
      const text = url.pathname + url.search;
      if (/%(?![0-9a-fA-F]{2})/.test(text)) {
        findings.push({severity: 'fail', detail: 'a % that is not valid percent-encoding'});
      }
      if (/%25[0-9a-fA-F]{2}/.test(text)) {
        findings.push({severity: 'fail', detail: 'double encoding (%25xx: an encoded % sign)'});
      }
      return findings;
    },
  },
};

/**
 * @param {string} href
 * @return {URL | null}
 */
function parse(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @param {UrlRule} rule
 * @return {Product}
 */
function buildUrlRuleProduct(artifact, rule) {
  if (!artifact || typeof artifact !== 'object') {
    return {score: 1, notApplicable: true, explanation: 'The site crawl was not collected.'};
  }
  const audited = typeof artifact.auditedUrl === 'string' ? parse(artifact.auditedUrl) : null;
  if (!audited) {
    return {score: 1, notApplicable: true, explanation: 'The audited URL could not be read.'};
  }

  const auditedFindings = rule.check(audited);
  const rows = auditedFindings.map(f => ({
    url: clip(audited.href),
    problem: f.detail,
    page: f.severity === 'note' ? 'audited page (note)' : 'audited page',
  }));

  const snapshot = artifact.snapshot;
  let compared = 1;
  let otherCount = 0;
  if (snapshot && Array.isArray(snapshot.pages)) {
    const seen = new Set([audited.href]);
    for (const page of snapshot.pages) {
      const href = page && (page.finalUrl || page.url);
      const url = typeof href === 'string' ? parse(href) : null;
      if (!url || seen.has(url.href)) continue;
      seen.add(url.href);
      compared++;
      for (const f of rule.check(url)) {
        otherCount++;
        rows.push({
          url: clip(url.href),
          problem: f.detail,
          page: f.severity === 'note' ? 'other crawled page (note)' : 'other crawled page',
        });
      }
    }
  }

  const failed = auditedFindings.some(f => f.severity === 'fail');
  const scope = compared > 1 ? ` (${compared} URLs checked)` : '';
  if (rows.length === 0) {
    return {score: 1, displayValue: `No problem found${scope}`};
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'url', valueType: 'text', label: 'URL'},
    {key: 'problem', valueType: 'text', label: 'Problem'},
    {key: 'page', valueType: 'text', label: 'Page'},
  ];
  const shown = rows.slice(0, MAX_ROWS);
  const items = [...shown];
  if (rows.length > shown.length) {
    items.push({url: `${rows.length - shown.length} more not shown`, problem: '', page: ''});
  }
  return {
    score: failed ? 0 : 1,
    displayValue: failed
      ? `The audited URL ${rule.failText}`
      : `The audited URL ${rule.passText}${
          otherCount ? `; ${otherCount} on other crawled URLs` : ''
        }`,
    explanation: failed
      ? `The audited page's URL ${rule.failText}: ${auditedFindings
          .filter(f => f.severity === 'fail')
          .map(f => f.detail)
          .join('; ')}.`
      : undefined,
    details: Audit.makeTableDetails(headings, items),
  };
}

export {
  buildUrlRuleProduct,
  RULES,
  MAX_URL_LENGTH,
  EXTREME_URL_LENGTH,
  MAX_PARAMS,
  MAX_ROWS,
  isTrackingParam,
  isSessionParam,
};
