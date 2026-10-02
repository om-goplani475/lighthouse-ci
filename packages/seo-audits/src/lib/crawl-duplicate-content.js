/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `duplicate-content` audit: do other crawled pages hold exactly the same
 * visible text as the audited page? Compares the snapshot's text hashes (sha-256 of the normalised visible
 * text), so only an exact match counts; similarity is a separate, later decision. No I/O, never throws.
 *
 * Rules, chosen with the developer:
 *   - pages under `MIN_WORDS` words are not compared (near-empty pages share a hash by accident; the
 *     `thin-content` audit covers them);
 *   - a page that declares a canonical to another URL has handed its duplicate to that URL, so it is not
 *     counted: a group is a duplicate problem only while two or more pages in it are their own canonical;
 *   - duplicates that differ only by a trailing slash or a query string are reported, with a note;
 *   - the audit fails when the audited page is in such a group; other groups are listed, not judged.
 *
 * Not trusted for: a page built by script (every empty app shell hashes the same), so the audit is not
 * applicable then; and a page the crawler had to truncate, which is left out.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {normalizeUrl} from './crawl-snapshot.js';
import {canonicalOf} from './crawl-canonicals.js';
import {scriptBuiltContent} from './crawl-coverage.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MIN_WORDS = 50;
const MAX_ROWS = 50;
const MAX_LISTED = 3;
const MAX_CELL_CHARS = 200;

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * A URL without its query and trailing slash, to tell "the same page under two spellings" from two
 * different pages with the same text.
 * @param {string} url
 * @return {string}
 */
function baseKey(url) {
  try {
    const u = new URL(url);
    // A loop, not `/\/+$/`: that regex is quadratic on a path of many slashes (a hostile URL).
    let end = u.pathname.length;
    while (end > 0 && u.pathname.charCodeAt(end - 1) === 47) end--;
    return `${u.origin}${u.pathname.slice(0, end)}`;
  } catch {
    return url;
  }
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildDuplicateContentProduct(artifact) {
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
  if (!audited) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'The crawler did not receive the audited page as HTML, so it was not compared.',
    };
  }
  const script = scriptBuiltContent(artifact);
  if (script) {
    return {
      score: 1,
      notApplicable: true,
      explanation: `The audited page shows ${script.rendered} characters of text in a browser but only ${script.server} in the HTML the crawler received, so comparing its text with other pages would be unreliable.`,
    };
  }
  if (audited.truncated) {
    return {
      score: 1,
      notApplicable: true,
      explanation:
        'The audited page was larger than the crawler reads, so its text was not compared.',
    };
  }
  if (!audited.textHash || audited.wordCount < MIN_WORDS) {
    return {
      score: 1,
      notApplicable: true,
      explanation: `The audited page has fewer than ${MIN_WORDS} words, which is too little to compare (thin-content covers it).`,
    };
  }

  // Each final URL once, only pages whose text can be compared.
  const seen = new Set();
  /** @type {Map<string, CrawlPage[]>} */
  const groups = new Map();
  let compared = 0;
  for (const page of snapshot.pages) {
    if (page.extraction !== 'ok' || page.truncated || !page.textHash) continue;
    if (page.wordCount < MIN_WORDS) continue;
    const final = normalizeUrl(page.finalUrl || page.url) || page.url;
    if (seen.has(final)) continue;
    seen.add(final);
    compared++;
    const list = groups.get(page.textHash) || [];
    list.push(page);
    groups.set(page.textHash, list);
  }
  if (compared < 2) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'The crawl reached no other page with enough text to compare.',
    };
  }

  /** @type {Array<{pages: CrawlPage[], involvesAudited: boolean, note: string}>} */
  const duplicateGroups = [];
  for (const members of groups.values()) {
    // A page that declares a canonical elsewhere has handed its duplicate over.
    const own = members.filter(p => canonicalOf(p) === null);
    if (own.length < 2) continue;
    const keys = new Set(own.map(p => baseKey(p.finalUrl || p.url)));
    duplicateGroups.push({
      pages: own,
      involvesAudited: own.includes(audited),
      note:
        keys.size === 1
          ? 'the same page under different URLs (trailing slash or query string)'
          : '',
    });
  }
  if (duplicateGroups.length === 0) {
    return {
      score: 1,
      displayValue: `No exact duplicates among ${compared} compared pages`,
    };
  }

  duplicateGroups.sort((a, b) => Number(b.involvesAudited) - Number(a.involvesAudited));
  const failing = duplicateGroups.filter(g => g.involvesAudited);
  const others = duplicateGroups.length - failing.length;
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'pages', valueType: 'text', label: 'Pages with identical text'},
    {key: 'words', valueType: 'text', label: 'Words'},
    {key: 'note', valueType: 'text', label: 'Note'},
    {key: 'audited', valueType: 'text', label: 'Includes the audited page'},
  ];
  const shown = duplicateGroups.slice(0, MAX_ROWS);
  const items = shown.map(g => {
    const urls = g.pages.map(p => p.finalUrl || p.url);
    const listed = urls.slice(0, MAX_LISTED).join(', ');
    const more = urls.length > MAX_LISTED ? ` and ${urls.length - MAX_LISTED} more` : '';
    return {
      pages: clip(listed + more),
      words: g.pages[0].wordCount,
      note: g.note,
      audited: g.involvesAudited ? 'yes' : '',
    };
  });
  if (duplicateGroups.length > shown.length) {
    items.push({
      pages: `${duplicateGroups.length - shown.length} more groups not shown`,
      words: /** @type {any} */ (''),
      note: '',
      audited: '',
    });
  }
  const otherNote = others
    ? ` ${others} other ${others === 1 ? 'group' : 'groups'} of identical pages ${
        others === 1 ? 'is' : 'are'
      } listed, not judged.`
    : '';
  return {
    score: failing.length ? 0 : 1,
    displayValue: failing.length
      ? `${failing[0].pages.length - 1} other ${
          failing[0].pages.length - 1 === 1 ? 'page has' : 'pages have'
        } identical text`
      : `${others} ${others === 1 ? 'group' : 'groups'} of duplicates on other pages`,
    explanation: failing.length
      ? `The audited page's visible text is identical to another crawled page's, and neither declares a canonical to the other. Point one at the other with a canonical, redirect it, or make the content different.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(headings, items),
  };
}

export {buildDuplicateContentProduct, baseKey, MIN_WORDS, MAX_ROWS};
