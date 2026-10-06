/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers shared by the vertical audits (e-commerce, local, news, video, entity): table and not-applicable products,
 * reading the site crawl safely, saying why the audited page could not be used, and comparing crawled pages with the
 * sitemap. No I/O, never throws.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {looseKey} from './url-key.js';

/** @typedef {import('./structured-facts.js').Entity} Entity */
/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;

/**
 * @param {CrawlPage} page
 * @return {boolean} Whether a crawled page is one worth judging: read as HTML, status 200, and not noindex.
 */
function isIndexablePage(page) {
  if (page.extraction !== 'ok' || page.status !== 200) return false;
  if (page.robotsMetas.some(m => /noindex|none/i.test(m.content))) return false;
  if (page.xRobotsTag.some(v => /noindex|none/i.test(v))) return false;
  return true;
}

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
  if (n === 1) return `${n} ${noun}`;
  // entry -> entries, but day -> days
  if (/[^aeiou]y$/i.test(noun)) return `${n} ${noun.slice(0, -1)}ies`;
  // address -> addresses, match -> matches, but page -> pages
  return /(s|x|z|ch|sh)$/i.test(noun) ? `${n} ${noun}es` : `${n} ${noun}s`;
}

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {Array<{heading: string, key: string}>} columns
 * @param {Array<Record<string, string>>} rows
 * @return {import('lighthouse/types/audit.js').default.Details.Table}
 */
function table(columns, rows) {
  return Audit.makeTableDetails(
    columns.map(c => ({key: c.key, valueType: /** @type {const} */ ('text'), label: c.heading})),
    rows.slice(0, MAX_ROWS)
  );
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {{snapshot: NonNullable<SiteCrawlArtifact['snapshot']>} | {reason: string}}
 */
function usableSnapshot(artifact) {
  if (!artifact || !artifact.snapshot) {
    return {
      reason:
        artifact && artifact.state === 'disabled'
          ? 'The site crawl is switched off.'
          : 'The site crawl was not collected.',
    };
  }
  return {snapshot: artifact.snapshot};
}

/**
 * @param {NonNullable<SiteCrawlArtifact['snapshot']>} snapshot
 * @return {string | null} Why the audited page cannot be used to judge product markup, or null when it was read in full.
 */
function auditedPageProblem(snapshot) {
  const audited = snapshot.pages.find(p => p.source === 'audited');
  if (!audited) return 'The crawl did not include the audited page.';
  if (audited.extraction === 'error' || audited.status === null) {
    return 'The crawler could not fetch the audited page.';
  }
  if (!(audited.status >= 200 && audited.status < 300)) {
    return `The crawler got status ${audited.status} for the audited page (a site can answer a crawler differently from a browser), so its product markup was not read.`;
  }
  if (audited.extraction !== 'ok') return 'The crawler could not read the audited page as HTML.';
  if (audited.truncated) {
    return 'The crawler read only the start of the audited page (it is larger than the size cap), so markup near its end may be missing.';
  }
  return null;
}

/**
 * @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {{listed: Set<string>} | {reason: string}} The set of listed URLs, or why a "not listed" verdict cannot be trusted.
 */
function listedUrls(sitemaps) {
  if (!sitemaps || sitemaps.discovery === 'none' || sitemaps.discovery === 'unavailable') {
    return {reason: 'No sitemap was found, so there is nothing to compare with.'};
  }
  if (sitemaps.documentsTruncated) {
    return {
      reason:
        'The sitemap has more files than were read, so a page missing from it cannot be proved.',
    };
  }
  const docs = sitemaps.documents || [];
  if (docs.some(d => d.outcome !== 'ok' || d.entriesTruncated || d.kind === 'invalid')) {
    return {
      reason:
        'A sitemap file could not be read in full, so a page missing from it cannot be proved.',
    };
  }
  /** @type {Set<string>} */
  const listed = new Set();
  for (const d of docs) {
    if (d.kind !== 'urlset') continue;
    for (const loc of d.locs) {
      const key = looseKey(loc);
      if (key) listed.add(key);
    }
  }
  return listed.size ? {listed} : {reason: 'The sitemap lists no URLs.'};
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps
 * @param {(page: CrawlPage) => boolean} isTarget Which crawled pages are the ones that should be listed.
 * @param {string} noun For messages, for example "product".
 * @return {Product}
 */
function sitemapCoverageProduct(artifact, sitemaps, isTarget, noun) {
  const usable = usableSnapshot(artifact);
  if (!('snapshot' in usable)) return notApplicable(usable.reason);
  const targets = usable.snapshot.pages.filter(isTarget);
  if (targets.length === 0) {
    const problem = auditedPageProblem(usable.snapshot);
    return notApplicable(problem || `The crawl found no ${noun} pages.`);
  }
  const listed = listedUrls(sitemaps);
  if (!('listed' in listed)) return notApplicable(listed.reason);
  const audited = usable.snapshot.pages.find(p => p.source === 'audited');
  const missing = targets.filter(
    p => !listed.listed.has(looseKey(p.finalUrl) || '') && !listed.listed.has(looseKey(p.url) || '')
  );
  if (missing.length === 0) {
    return {score: 1, displayValue: `${count(targets.length, `${noun} page`)} listed`};
  }
  const auditedMissing = !!audited && missing.includes(audited);
  /** @type {Product} */
  const product = {
    // As the other cross-page audits: the audited page is what is judged; the rest are listed.
    score: auditedMissing ? 0.5 : 1,
    displayValue: `${missing.length} of ${targets.length} ${noun} pages not listed`,
    details: table(
      [
        {key: 'url', heading: 'Page'},
        {key: 'note', heading: 'Note'},
      ],
      missing.map(p => ({url: clip(p.finalUrl), note: p === audited ? 'The audited page' : ''}))
    ),
  };
  if (auditedMissing) {
    product.explanation = `This ${noun} page is not in any sitemap. Sitemaps help crawlers find and recrawl pages; list every page you want indexed.`;
  } else {
    product.explanation = `${missing.length} other crawled ${noun} page${
      missing.length === 1 ? ' is' : 's are'
    } not in any sitemap (listed below, not judged). The audited page is listed.`;
  }
  return product;
}

/**
 * @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {string} A sentence saying how many sitemap files could not be read and why, or '' when all were. Used so that
 *   "no such sitemap was found" is never said when one may exist behind a file that could not be read.
 */
function unreadSitemapsNote(sitemaps) {
  const docs = (sitemaps && sitemaps.documents) || [];
  const unread = docs.filter(d => d.outcome !== 'ok');
  if (unread.length === 0 && !(sitemaps && sitemaps.documentsTruncated)) return '';
  const redirects = unread.filter(d => d.outcome === 'redirect').length;
  const parts = [];
  if (unread.length) {
    parts.push(
      `${count(unread.length, 'sitemap file')} could not be read${
        redirects
          ? ` (${redirects} answered with a redirect, which the audits do not follow: declare the final address in robots.txt)`
          : ''
      }`
    );
  }
  if (sitemaps && sitemaps.documentsTruncated) {
    parts.push('the sitemap has more files than the audits read');
  }
  return ` ${parts.join('; ')}, so one may exist that was not seen.`;
}

// ISO 8601 (W3C) date or date-time, as Google accepts in structured data and sitemaps.
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * @param {string} value
 * @return {{ok: boolean, ms: number, hasTime: boolean, hasZone: boolean}} Whether it is an ISO 8601 date or date-time (a real calendar date), and when.
 */
function parseIsoDate(value) {
  const m = ISO_DATE.exec(value.trim());
  const bad = {ok: false, ms: NaN, hasTime: false, hasZone: false};
  if (!m) return bad;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return bad;
  const hasTime = m[4] !== undefined;
  if (
    hasTime &&
    (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))
  ) {
    return bad;
  }
  const zone = m[7];
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}${
    zone
      ? zone === 'Z'
        ? 'Z'
        : zone.length === 5
        ? `${zone.slice(0, 3)}:${zone.slice(3)}`
        : zone
      : 'Z'
  }`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? bad : {ok: true, ms, hasTime, hasZone: zone !== undefined};
}

/**
 * @typedef {{url: string, kind: 'gone' | 'missing-host' | 'status' | 'failed', status: number | null, message: string, severity: 'problem' | 'note'}} ProbeRow
 */

/**
 * Requests the status of up to `max` URLs, one at a time, and keeps only those that are not a 2xx. The package's probe-refusal
 * policy: a 404 or 410, or a host that does not exist or refuses the connection, is a defect (`problem`); any other status
 * (401, 403, 406, 429, 5xx...) or failure (a timeout, a private address) is only a note, because bot protection and brief
 * failures look the same.
 * @param {{
 *   urls: string[], pageUrl: string, max: number,
 *   fetchStatus: (url: string, firstParty: boolean) => Promise<{status: number}>,
 *   siteOf: (host: string) => string,
 * }} input `firstParty` tells the fetcher the URL is on the audited page's own site.
 * @return {Promise<{rows: ProbeRow[], checked: number, notChecked: number}>}
 */
async function probeStatuses({urls, pageUrl, max, fetchStatus, siteOf}) {
  const unique = [...new Set(urls)];
  /** @type {ProbeRow[]} */
  const rows = [];
  let pageSite = '';
  try {
    pageSite = siteOf(new URL(pageUrl).hostname);
  } catch (_) {
    pageSite = '';
  }
  const toCheck = unique.slice(0, Math.max(0, max));
  for (const url of toCheck) {
    let firstParty = false;
    try {
      firstParty = !!pageSite && siteOf(new URL(url).hostname) === pageSite;
    } catch (_) {
      firstParty = false;
    }
    try {
      const {status} = await fetchStatus(url, firstParty);
      if (status >= 200 && status < 300) continue;
      rows.push({
        url,
        kind: status === 404 || status === 410 ? 'gone' : 'status',
        status,
        message: '',
        severity: status === 404 || status === 410 ? 'problem' : 'note',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const missing = /ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(message);
      rows.push({
        url,
        kind: missing ? 'missing-host' : 'failed',
        status: null,
        message: clip(message),
        severity: missing ? 'problem' : 'note',
      });
    }
  }
  return {rows, checked: toCheck.length, notChecked: Math.max(0, unique.length - toCheck.length)};
}

const LEGAL_WORDS = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'gmbh',
  'co',
  'corp',
  'corporation',
  'company',
  'plc',
  'sa',
  'srl',
  'bv',
  'ag',
  'the',
]);

/** @param {string | null} name @return {string} A name without case, accents, punctuation and legal-form words. */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w && !LEGAL_WORDS.has(w))
    .join(' ');
}

export {
  normalizeName,
  probeStatuses,
  parseIsoDate,
  unreadSitemapsNote,
  MAX_ROWS,
  MAX_CELL_CHARS,
  clip,
  count,
  notApplicable,
  table,
  usableSnapshot,
  auditedPageProblem,
  listedUrls,
  sitemapCoverageProduct,
  isIndexablePage,
};
