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
const SOURCE_LABEL = {
  audited: 'audited page',
  home: 'homepage',
  link: 'link on a page',
  sitemap: 'sitemap',
};
const SKIP_LABEL = {
  'blocked-by-robots': 'blocked by robots.txt',
  'cross-origin': 'other origin, not requested',
  'over-page-cap': 'over the page cap',
  'not-checked': 'not checked',
  failed: 'failed',
  'query-variants': 'too many query-string variants of one path',
  'not-a-page': 'a file, not a page',
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
  if (snapshot.stats.overPageCap) {
    notes.push(
      `More pages were found than the page cap (${snapshot.bounds.pages}), so the deepest were left out: what was crawled is the part of the site nearest the audited page and the homepage, not the whole site. Raise LHCI_SEO_CRAWL_MAX_PAGES to see more.`
    );
  }
  if (snapshot.stats.cutByDepth) {
    notes.push(
      `The crawl followed links ${snapshot.bounds.depth} ${
        snapshot.bounds.depth === 1 ? 'hop' : 'hops'
      } from its starting pages and stopped there: pages further away were not requested. Raise LHCI_SEO_CRAWL_MAX_DEPTH to follow further.`
    );
  }
  const linkChecks = artifact.linkChecks;
  if (linkChecks && (linkChecks.checked.length > 0 || linkChecks.notChecked > 0)) {
    const blocked = linkChecks.checked.filter(c => c.state === 'blocked-by-robots').length;
    const requested = linkChecks.checked.length - blocked;
    notes.push(
      `${count(requested, 'internal link')} of the audited page that the crawl did not read ${
        requested === 1 ? 'was' : 'were'
      } status-checked (no page body read)${
        blocked ? `; ${blocked} disallowed by robots.txt, not requested` : ''
      }${
        linkChecks.notChecked
          ? `; ${linkChecks.notChecked} more not checked (the limit, the time budget or an unreadable robots.txt: LHCI_SEO_CRAWL_MAX_LINK_CHECKS)`
          : ''
      }.`
    );
  }
  const externalChecks = artifact.externalChecks;
  if (externalChecks && (externalChecks.checked.length > 0 || externalChecks.notChecked > 0)) {
    const refused = externalChecks.checked.filter(c => c.error === 'PRIVATE').length;
    const requested = externalChecks.checked.length - refused;
    notes.push(
      `${count(requested, 'external link')} of the audited page ${
        requested === 1 ? 'was' : 'were'
      } status-checked on other sites (status only, no body read, at most 2 per host)${
        refused ? `; ${refused} pointing at a private address not requested` : ''
      }${
        externalChecks.notChecked
          ? `; ${externalChecks.notChecked} more not checked (the per-host limit, the limit or the time budget: LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS)`
          : ''
      }.`
    );
  }
  const variants = snapshot.skipped.filter(s => s.reason === 'query-variants').length;
  if (variants > 0) {
    notes.push(
      `${count(
        variants,
        'URL'
      )} with more than 5 query-string variants of one path were not requested (a crawl-trap guard).`
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
 * @return {{url: string, status: string, depth: number | string, title: string, words: number | string, source: string}}
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
    depth: page.depth,
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
    {key: 'depth', valueType: 'text', label: 'Depth'},
    {key: 'title', valueType: 'text', label: 'Title'},
    {key: 'words', valueType: 'text', label: 'Words'},
    {key: 'source', valueType: 'text', label: 'Found by'},
  ];
  const notes = notesFor(artifact).map(note => ({
    url: `Note: ${note}`,
    status: '',
    depth: '',
    title: '',
    words: '',
    source: '',
  }));
  const rows = [
    ...pages.map(pageRow),
    ...snapshot.skipped.map(s => ({
      url: clip(s.url),
      status: SKIP_LABEL[s.reason] || s.reason,
      depth: '',
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
    items.push({
      url: `${hidden} more not shown`,
      status: '',
      depth: '',
      title: '',
      words: '',
      source: '',
    });
  }
  return {
    score: 1,
    displayValue,
    details: Audit.makeTableDetails(headings, items),
  };
}

export {buildCoverageProduct, scriptBuiltContent, MAX_ROWS};
