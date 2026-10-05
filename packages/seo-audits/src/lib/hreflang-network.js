/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hreflang result builders that read what the alternate versions answered (see `hreflang-checks.js`):
 * `hreflang-return-links`, `hreflang-alternate-status` and `hreflang-canonical`, all scored. No I/O, never throws.
 *
 * Calibrated to fail only on objective defects. A return link is judged only when the alternate has hreflang tags
 * in its HTML and none names this page; an alternate with none may carry its tags in an HTTP header or only in the
 * sitemap, so that is a note. Only a 404/410, a name or connection failure, a redirect or a noindex fails the
 * status audit; 401/403/429, server errors, timeouts and TLS errors are notes (bot protection and transient
 * trouble are not defects of the page).
 */

import {looseKey} from './url-key.js';
import {clip, gate, notApplicable, selfKeyOf, table} from './hreflang-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/hreflang-data.js').HreflangDataArtifact} HreflangDataArtifact */
/** @typedef {import('./hreflang-checks.js').AlternateCheck} AlternateCheck */

const GONE_ERRORS = new Set(['ENOTFOUND', 'ECONNREFUSED']);

/**
 * @param {unknown} data
 * @return {Product | {data: HreflangDataArtifact, results: AlternateCheck[]}} A not-applicable result, or what to
 *   judge.
 */
function prepare(data) {
  const skip = gate(data);
  if (skip) return skip;
  const d = /** @type {HreflangDataArtifact} */ (data);
  const checks = d.checks;
  if (!checks || checks.state !== 'checked') {
    return notApplicable(
      checks && checks.reason ? checks.reason : 'The alternate versions were not requested.'
    );
  }
  const results = Array.isArray(checks.results)
    ? checks.results.filter(r => r && typeof r === 'object')
    : [];
  if (results.length === 0) return notApplicable('No alternate version could be requested.');
  return {data: d, results};
}

/**
 * @param {AlternateCheck} check
 * @return {boolean}
 */
function readable(check) {
  return (
    check.error === null &&
    check.status !== null &&
    check.status >= 200 &&
    check.status < 300 &&
    check.bodyRead === 'html'
  );
}

/**
 * @param {HreflangDataArtifact} data
 * @return {string} A note about alternates that were not requested.
 */
function notCheckedNote(data) {
  const n = data.checks && data.checks.notChecked;
  return n ? `; ${n} more not requested (LHCI_SEO_HREFLANG_MAX_CHECKS or the time budget)` : '';
}

/**
 * @param {unknown} data
 * @return {Product}
 */
function buildReturnLinksProduct(data) {
  const ready = prepare(data);
  if ('score' in ready) return ready;
  const {data: d, results} = ready;
  const keys = new Set([selfKeyOf(d), looseKey(d.canonical)].filter(Boolean));
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  let judged = 0;
  let failed = 0;
  for (const r of results) {
    if (!readable(r)) continue;
    const links = r.alternates.some(a => keys.has(looseKey(a.href)));
    if (r.hasHreflang && !links) {
      judged++;
      failed++;
      rows.push({
        alternate: clip(r.url),
        hreflang: r.hreflang,
        result: 'does not link back to this page',
      });
    } else if (!r.hasHreflang) {
      rows.push({
        alternate: clip(r.url),
        hreflang: r.hreflang,
        result:
          'note: no hreflang links in its HTML (they may be in an HTTP header or only in the sitemap), not judged',
      });
    } else {
      judged++;
    }
  }
  if (judged === 0 && rows.length === 0) {
    return notApplicable('None of the alternate versions returned an HTML page to read.');
  }
  const headings = /** @type {Array<[string, string]>} */ ([
    ['alternate', 'Alternate version'],
    ['hreflang', 'hreflang'],
    ['result', 'Result'],
  ]);
  if (failed === 0) {
    return {
      score: 1,
      displayValue: `${judged} of ${judged} judged alternates link back${notCheckedNote(d)}`,
      details: rows.length ? table(rows, headings) : undefined,
    };
  }
  return {
    score: 0,
    displayValue: `${failed} of ${judged} judged ${
      judged === 1 ? 'alternate does' : 'alternates do'
    } not link back`,
    explanation:
      'Every version must list the others and itself: when A names B but B does not name A, search engines can ignore the pair. Add the missing return link on the alternate version.',
    details: table(rows, headings),
  };
}

/**
 * @param {unknown} data
 * @return {Product}
 */
function buildAlternateStatusProduct(data) {
  const ready = prepare(data);
  if ('score' in ready) return ready;
  const {data: d, results} = ready;
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  let failed = 0;
  for (const r of results) {
    /** @type {string | null} */
    let fail = null;
    /** @type {string | null} */
    let note = null;
    if (r.error !== null) {
      if (GONE_ERRORS.has(r.error)) {
        fail = r.error === 'ENOTFOUND' ? 'the host does not exist' : 'the connection was refused';
      } else if (r.error === 'PRIVATE') note = 'a private address, not requested';
      else note = 'could not be checked (a timeout, a TLS error or a network problem)';
    } else if (r.status !== null && r.status >= 300 && r.status < 400) {
      fail = `redirects${
        r.redirectLocation ? ` to ${clip(r.redirectLocation, 80)}` : ''
      }; hreflang should name the final URL`;
    } else if (r.status === 404 || r.status === 410) {
      fail = `answers ${r.status} (gone)`;
    } else if (r.status === 401 || r.status === 403 || r.status === 429) {
      note = `answered ${r.status}, which is often bot protection; not judged`;
    } else if (r.status !== null && r.status >= 400) {
      note = `answered ${r.status}, which may be temporary; not judged`;
    } else if (r.status !== null && r.status >= 200 && r.noindex) {
      fail = 'is noindex, so it cannot be shown as an alternate';
    }
    if (fail) {
      failed++;
      rows.push({alternate: clip(r.url), hreflang: r.hreflang, result: fail});
    } else if (note) {
      rows.push({alternate: clip(r.url), hreflang: r.hreflang, result: `note: ${note}`});
    }
  }
  const headings = /** @type {Array<[string, string]>} */ ([
    ['alternate', 'Alternate version'],
    ['hreflang', 'hreflang'],
    ['result', 'Result'],
  ]);
  if (failed === 0) {
    return {
      score: 1,
      displayValue: `${results.length} alternates answer normally${notCheckedNote(d)}`,
      details: rows.length ? table(rows, headings) : undefined,
    };
  }
  return {
    score: 0,
    displayValue: `${failed} of ${results.length} ${
      failed === 1 ? 'alternate has' : 'alternates have'
    } a problem`,
    explanation:
      'hreflang should name pages that exist, answer 200 without a redirect, and can be indexed. A gone, redirecting or noindex alternate is ignored and weakens the whole set.',
    details: table(rows, headings),
  };
}

/**
 * @param {unknown} data
 * @return {Product}
 */
function buildCanonicalProduct(data) {
  const skip = gate(data);
  if (skip) return skip;
  const d = /** @type {HreflangDataArtifact} */ (data);
  const selfKey = selfKeyOf(d);
  /** @type {Map<string, string>} */
  const others = new Map();
  for (const a of d.alternates) {
    const key = looseKey(a.href);
    if (key && key !== selfKey) others.set(key, a.hreflang);
  }
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  const canonicalKey = looseKey(d.canonical);
  if (canonicalKey && canonicalKey !== selfKey && others.has(canonicalKey)) {
    rows.push({
      page: 'this page',
      problem: `its canonical is the ${others.get(canonicalKey)} version (${clip(
        String(d.canonical),
        100
      )}), so it tells search engines it is a copy of that version`,
    });
  }
  const results = d.checks && Array.isArray(d.checks.results) ? d.checks.results : [];
  for (const r of results) {
    if (!r || !readable(r) || r.canonicals.length !== 1) continue;
    const key = looseKey(r.canonicals[0]);
    if (key && key !== looseKey(r.url)) {
      rows.push({
        page: clip(r.url),
        problem: `its canonical is ${clip(
          r.canonicals[0],
          100
        )}, not the URL that hreflang names; hreflang should name the canonical URL`,
      });
    }
  }
  const compared = results.filter(r => r && readable(r)).length;
  if (rows.length === 0) {
    if (!canonicalKey && compared === 0) {
      return notApplicable('There is no canonical to compare with the hreflang URLs.');
    }
    return {score: 1, displayValue: 'The canonicals agree with the hreflang URLs'};
  }
  return {
    score: 0,
    displayValue: `${rows.length} canonical ${rows.length === 1 ? 'conflict' : 'conflicts'}`,
    explanation:
      'A canonical that points at another language version, or an hreflang URL that is not the page canonical, sends search engines two opposite signals. Each version should be its own canonical and be the URL that hreflang names.',
    details: table(rows, [
      ['page', 'Page'],
      ['problem', 'Problem'],
    ]),
  };
}

export {buildReturnLinksProduct, buildAlternateStatusProduct, buildCanonicalProduct};
