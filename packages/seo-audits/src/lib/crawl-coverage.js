/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `crawl-coverage` audit: what the site crawl saw, in one
 * table, with the limits stated. It exists so the crawl is visible and verifiable, and so the cross-page
 * audits that read the same snapshot have one place to point to for "how much of the site was seen".
 * No I/O, never throws.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_ROWS = 100;
const MAX_CELL_CHARS = 200;
const SOURCE_LABEL = {audited: 'audited page', link: 'link on the page', sitemap: 'sitemap'};
const SKIP_LABEL = {
  'blocked-by-robots': 'blocked by robots.txt',
  'cross-origin': 'other origin, not requested',
  'over-page-cap': 'over the page cap',
  'not-checked': 'not checked',
  failed: 'failed',
};

/**
 * @param {string} text
 * @param {number} [max]
 * @return {string}
 */
function clip(text, max = MAX_CELL_CHARS) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
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
 * Whether the audited page's content looks to be built by script: a browser shows far more text than its
 * server HTML holds.
 * @param {SiteCrawlArtifact} artifact
 * @return {{rendered: number, server: number} | null}
 */
function scriptBuiltContent(artifact) {
  const snapshot = artifact.snapshot;
  const rendered = artifact.auditedRenderedTextLength;
  if (!snapshot || rendered === null || rendered === undefined) return null;
  const audited = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  if (!audited) return null;
  return rendered - audited.textLength > 200 && audited.textLength < rendered * 0.5
    ? {rendered, server: audited.textLength}
    : null;
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {string[]}
 */
function notesFor(artifact) {
  const snapshot = /** @type {NonNullable<SiteCrawlArtifact['snapshot']>} */ (artifact.snapshot);
  /** @type {string[]} */
  const notes = [];
  if (artifact.state === 'cached') {
    notes.push(
      `Reused from a crawl made at ${snapshot.createdAt} (the cache lifetime has not passed).`
    );
  }
  if (snapshot.stats.truncatedByBudget) {
    notes.push(
      `The crawl stopped at its time budget (${Math.round(
        snapshot.bounds.budgetMs / 1000
      )} s): the rest was not checked.`
    );
  }
  const overCap = snapshot.skipped.some(s => s.reason === 'over-page-cap');
  if (overCap) {
    notes.push(
      `More URLs were found than the page cap (${snapshot.bounds.pages}); the pages crawled are an evenly spread sample, not the whole site.`
    );
  }
  const blocked = snapshot.skipped.filter(s => s.reason === 'blocked-by-robots').length;
  if (snapshot.robots.state === 'unavailable') {
    notes.push('robots.txt could not be read, so only the audited page was requested.');
  } else if (snapshot.robots.state === 'ignored') {
    notes.push(
      'robots.txt was ignored (LHCI_SEO_CRAWL_RESPECT_ROBOTS), so disallowed URLs were requested.'
    );
  } else if (blocked > 0) {
    notes.push(`robots.txt disallowed ${count(blocked, 'URL')}, which were not requested.`);
  }
  const script = scriptBuiltContent(artifact);
  if (script) {
    notes.push(
      `The audited page shows ${script.rendered} characters of text in a browser but only ${script.server} in the HTML the crawler received: either its content is built by script, or the server answers the crawler differently from a browser, so comparing pages by their server HTML is unreliable here.`
    );
  }
  notes.push(
    'The crawl reads server HTML only: a page built by JavaScript can look like an empty shell, so pages that look identical here may differ in a browser.'
  );
  return notes;
}

/**
 * @param {CrawlPage} page
 * @return {{url: string, status: string, title: string, words: number | string, source: string}}
 */
function pageRow(page) {
  const status =
    page.extraction === 'error' || page.status === null
      ? 'error (no response)'
      : page.extraction === 'skipped-not-html'
      ? `${page.status} (not HTML)`
      : String(page.status);
  const shown =
    page.finalUrl && page.finalUrl !== page.url ? `${page.url} -> ${page.finalUrl}` : page.url;
  return {
    url: clip(shown),
    status,
    title: page.title ? clip(page.title, 100) : '',
    words: page.extraction === 'ok' ? page.wordCount : '',
    source: SOURCE_LABEL[page.source] || page.source,
  };
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildCoverageProduct(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return {score: 1, notApplicable: true, explanation: 'The site crawl was not collected.'};
  }
  if (artifact.state === 'disabled') {
    return {
      score: 1,
      notApplicable: true,
      explanation: artifact.reason || 'The site crawl is switched off.',
    };
  }
  const snapshot = artifact.snapshot;
  if (artifact.state === 'unavailable' || !snapshot || !Array.isArray(snapshot.pages)) {
    return {
      score: 1,
      notApplicable: true,
      explanation: artifact.reason || 'The site crawl could not run.',
    };
  }

  const pages = snapshot.pages;
  const crawled = pages.filter(p => p.extraction === 'ok').length;
  const errors = pages.filter(
    p => p.extraction === 'error' || (p.status !== null && p.status >= 400)
  ).length;
  const blocked = snapshot.skipped.filter(s => s.reason === 'blocked-by-robots').length;
  const parts = [];
  if (blocked) parts.push(`${blocked} blocked by robots.txt`);
  if (errors) parts.push(count(errors, 'error'));
  const displayValue =
    `Crawled ${crawled} of ${snapshot.bounds.pages} ${
      snapshot.bounds.pages === 1 ? 'page' : 'pages'
    }` + (parts.length ? ` (${parts.join(', ')})` : '');

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'url', valueType: 'text', label: 'URL'},
    {key: 'status', valueType: 'text', label: 'Result'},
    {key: 'title', valueType: 'text', label: 'Title'},
    {key: 'words', valueType: 'text', label: 'Words'},
    {key: 'source', valueType: 'text', label: 'Found by'},
  ];
  const notes = notesFor(artifact).map(note => ({
    url: `Note: ${note}`,
    status: '',
    title: '',
    words: '',
    source: '',
  }));
  const rows = [
    ...pages.map(pageRow),
    ...snapshot.skipped.map(s => ({
      url: clip(s.url),
      status: SKIP_LABEL[s.reason] || s.reason,
      title: '',
      words: '',
      source: '',
    })),
  ];
  const room = Math.max(0, MAX_ROWS - notes.length);
  const shown = rows.slice(0, room);
  const hidden = rows.length - shown.length;
  const items = [...notes, ...shown];
  if (hidden > 0) {
    items.push({url: `${hidden} more not shown`, status: '', title: '', words: '', source: ''});
  }
  return {
    score: 1,
    displayValue,
    details: Audit.makeTableDetails(headings, items),
  };
}

export {buildCoverageProduct, scriptBuiltContent, MAX_ROWS};
