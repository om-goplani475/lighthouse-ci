/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `url-case-variants`, `url-trailing-slash-variants` and
 * `url-normalization` audits: does the crawl hold several live URLs that are really one resource? Reads the
 * site crawl's snapshot only (no request), so it sees only variants the crawled pages link to or the
 * sitemap lists. No I/O, never throws.
 *
 * Rules, chosen with the developer: pages are grouped by a normal form of their final URL (case, trailing
 * slash, repeated slashes, an index file name, session and tracking parameters and query order removed).
 * A group is a problem when two or more of its URLs answered 200 as HTML and their canonicals do not all
 * name one URL. The audit fails when the audited page is in such a group; other groups are listed. A
 * variant that redirects to the main URL is not a group, because the crawl records the final URL.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {normalizeUrl} from './crawl-snapshot.js';
import {isSessionParam, isTrackingParam} from './url-quality.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {'case' | 'slash' | 'any'} VariantKind */
/** @typedef {{members: CrawlPage[], kinds: Set<string>, canonicals: string[], involvesAudited: boolean}} VariantGroup */

const MAX_GROUPS = 15;
const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const INDEX_FILE = /\/(index|default)\.(html?|php|aspx?|jsp)$/i;
const TEXT = {
  case: {
    subject: 'letter case',
    title: 'URLs that differ only in letter case',
    explain: 'differ only in upper and lower case',
  },
  slash: {
    subject: 'trailing slash',
    title: 'URLs that differ only by a trailing slash',
    explain: 'differ only by a trailing slash',
  },
  any: {
    subject: 'URL form',
    title: 'URLs that are the same page in another form',
    explain:
      'are one page written in different forms (case, trailing slash, repeated slashes, index file, tracking or session parameters, parameter order)',
  },
};

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * @param {string} path
 * @return {string}
 */
function stripSlash(path) {
  // A loop, not /\/+$/: that pattern is quadratic on a long run of slashes.
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  return path.slice(0, end);
}

/**
 * The normal form two URLs of one resource share.
 * @param {string} href
 * @return {string | null}
 */
function normalForm(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  let path = url.pathname
    .replace(/\/{2,}/g, '/')
    .toLowerCase()
    .replace(INDEX_FILE, '/');
  path = stripSlash(path);
  const params = Array.from(url.searchParams)
    .filter(([name, value]) => !isTrackingParam(name) && !isSessionParam(name, value))
    .map(([name, value]) => `${name.toLowerCase()}=${value}`)
    .sort();
  return `${url.protocol}//${url.host}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

/**
 * What the page says its URL is: its one canonical, or itself.
 * @param {CrawlPage} page
 * @return {string}
 */
function effectiveCanonical(page) {
  const self = normalizeUrl(page.finalUrl || page.url) || page.finalUrl || page.url;
  if (!Array.isArray(page.canonicals) || page.canonicals.length !== 1) return self;
  return normalizeUrl(page.canonicals[0], page.finalUrl || page.url) || self;
}

/**
 * Which differences exist between the members of a group.
 * @param {CrawlPage[]} members
 * @return {Set<string>}
 */
function kindsOf(members) {
  /** @type {Set<string>} */
  const kinds = new Set(['any']);
  /** @type {Map<string, Set<string>>} */
  const byLower = new Map();
  /** @type {Map<string, Set<string>>} */
  const byStripped = new Map();
  for (const m of members) {
    let path;
    try {
      path = new URL(m.finalUrl || m.url).pathname;
    } catch {
      continue;
    }
    const lower = path.toLowerCase();
    const stripped = stripSlash(path);
    if (!byLower.has(lower)) byLower.set(lower, new Set());
    /** @type {Set<string>} */ (byLower.get(lower)).add(path);
    if (!byStripped.has(stripped)) byStripped.set(stripped, new Set());
    /** @type {Set<string>} */ (byStripped.get(stripped)).add(path);
  }
  for (const paths of byLower.values()) if (paths.size > 1) kinds.add('case');
  for (const paths of byStripped.values()) if (paths.size > 1) kinds.add('slash');
  return kinds;
}

/**
 * @param {CrawlPage[]} pages
 * @param {CrawlPage | undefined} audited
 * @return {VariantGroup[]}
 */
function findGroups(pages, audited) {
  /** @type {Map<string, CrawlPage[]>} */
  const byKey = new Map();
  /** @type {Set<string>} */
  const seen = new Set();
  for (const page of pages) {
    if (page.extraction !== 'ok' || page.status !== 200) continue;
    const href = page.finalUrl || page.url;
    if (seen.has(href)) continue;
    seen.add(href);
    const key = normalForm(href);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(page);
    else byKey.set(key, [page]);
  }
  /** @type {VariantGroup[]} */
  const groups = [];
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const canonicals = members.map(effectiveCanonical);
    if (new Set(canonicals).size === 1) continue; // one canonical resolves the group
    groups.push({
      members,
      kinds: kindsOf(members),
      canonicals,
      involvesAudited: !!audited && members.includes(audited),
    });
  }
  return groups;
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @param {VariantKind} kind
 * @return {Product}
 */
function buildVariantProduct(artifact, kind) {
  const text = TEXT[kind];
  if (!artifact || typeof artifact !== 'object') {
    return {score: 1, notApplicable: true, explanation: 'The site crawl was not collected.'};
  }
  if (artifact.state === 'disabled' || artifact.state === 'unavailable') {
    return {
      score: 1,
      notApplicable: true,
      explanation: artifact.reason || 'The site crawl did not run.',
    };
  }
  const snapshot = artifact.snapshot;
  if (!snapshot || !Array.isArray(snapshot.pages)) {
    return {score: 1, notApplicable: true, explanation: 'The site crawl could not run.'};
  }
  const audited = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  const live = new Set(
    snapshot.pages
      .filter(p => p.extraction === 'ok' && p.status === 200)
      .map(p => p.finalUrl || p.url)
  );
  if (live.size < 2) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'The crawl reached no other page to compare the audited URL with.',
    };
  }

  const groups = findGroups(snapshot.pages, audited).filter(g => g.kinds.has(kind));
  if (groups.length === 0) {
    return {score: 1, displayValue: `No ${text.subject} variants among ${live.size} crawled URLs`};
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'group', valueType: 'text', label: 'Group'},
    {key: 'url', valueType: 'text', label: 'URL (answered 200)'},
    {key: 'canonical', valueType: 'text', label: 'Declared canonical'},
    {key: 'page', valueType: 'text', label: 'Page'},
  ];
  const items = [];
  let rowsLeft = MAX_ROWS;
  let groupNo = 0;
  for (const group of groups.slice(0, MAX_GROUPS)) {
    groupNo++;
    for (const member of group.members) {
      if (rowsLeft-- <= 0) break;
      const declared = Array.isArray(member.canonicals) ? member.canonicals.length : 0;
      items.push({
        group: String(groupNo),
        url: clip(member.finalUrl || member.url),
        canonical: declared === 1 ? clip(member.canonicals[0]) : declared > 1 ? 'several' : 'none',
        page: member === audited ? 'audited page' : 'other crawled page',
      });
    }
  }
  const hidden = groups.length - Math.min(groups.length, MAX_GROUPS);
  if (hidden > 0) {
    items.push({group: '', url: `${hidden} more groups not shown`, canonical: '', page: ''});
  }

  const mine = groups.filter(g => g.involvesAudited);
  const failed = mine.length > 0;
  return {
    score: failed ? 0 : 1,
    displayValue: failed
      ? `The audited URL has ${text.subject} variants`
      : `${groups.length} ${text.subject} ${
          groups.length === 1 ? 'group' : 'groups'
        } on other pages`,
    explanation: failed
      ? `The audited page and ${mine[0].members.length - 1} other crawled ${
          mine[0].members.length === 2 ? 'URL' : 'URLs'
        } ${
          text.explain
        }, and all of them answered 200 without one canonical URL naming a single version. Redirect the variants to one URL or point their canonical at it.`
      : undefined,
    details: Audit.makeTableDetails(headings, items),
  };
}

export {buildVariantProduct, findGroups, normalForm, MAX_ROWS, MAX_GROUPS};
