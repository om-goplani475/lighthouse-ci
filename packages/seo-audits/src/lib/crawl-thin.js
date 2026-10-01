/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `thin-content` audit: does the audited page hold fewer than
 * `THIN_WORD_COUNT` words of visible text in its server HTML? Reads the site crawl's snapshot. No I/O,
 * never throws.
 *
 * Rules, chosen with the developer: under 200 words is thin; the text-to-HTML ratio is shown, never
 * judged (a low ratio is normal on healthy pages); the audit judges the audited page only, and lists the
 * other thin crawled pages for information.
 *
 * Words are counted from server HTML, so a page built by script reads as thin. When the audited page
 * clearly is (a browser shows far more text than the server HTML holds, see `scriptBuiltContent`), the
 * audit is not applicable rather than wrong.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {scriptBuiltContent} from './crawl-coverage.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const THIN_WORD_COUNT = 200;
const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * Visible characters per byte of HTML read, as a percentage (characters, not bytes, so it is
 * approximate for non-ASCII text).
 * @param {CrawlPage} page
 * @return {string}
 */
function ratio(page) {
  if (!page.bytes) return '';
  return `${Math.min(100, Math.round((page.textLength / page.bytes) * 100))}%`;
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildThinContentProduct(artifact) {
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
      explanation: 'The crawler did not receive the audited page as HTML, so it was not measured.',
    };
  }
  const script = scriptBuiltContent(artifact);
  if (script) {
    return {
      score: 1,
      notApplicable: true,
      explanation: `The audited page shows ${script.rendered} characters of text in a browser but only ${script.server} in the HTML the crawler received, so its length cannot be judged from server HTML.`,
    };
  }
  if (audited.truncated && audited.wordCount < THIN_WORD_COUNT) {
    return {
      score: 1,
      notApplicable: true,
      explanation:
        'The audited page was larger than the crawler reads, so its word count is not reliable.',
    };
  }

  const thin = audited.wordCount < THIN_WORD_COUNT;
  const seen = new Set([audited.finalUrl]);
  /** @type {CrawlPage[]} */
  const others = [];
  for (const page of snapshot.pages) {
    if (page === audited || page.extraction !== 'ok' || page.truncated) continue;
    if (seen.has(page.finalUrl)) continue;
    seen.add(page.finalUrl);
    if (page.wordCount < THIN_WORD_COUNT) others.push(page);
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'url', valueType: 'text', label: 'Page'},
    {key: 'words', valueType: 'text', label: 'Words'},
    {key: 'ratio', valueType: 'text', label: 'Text-to-HTML'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  const shown = others.slice(0, MAX_ROWS);
  /** @type {Array<{url: string, words: number | string, ratio: string, note: string}>} */
  const items = [
    {
      url: clip(audited.finalUrl || audited.url),
      words: audited.wordCount,
      ratio: ratio(audited),
      note: thin ? 'audited page, thin' : 'audited page',
    },
    ...shown.map(p => ({
      url: clip(p.finalUrl || p.url),
      words: p.wordCount,
      ratio: ratio(p),
      note: 'other crawled page, thin',
    })),
  ];
  if (others.length > shown.length) {
    items.push({
      url: `${others.length - shown.length} more not shown`,
      words: '',
      ratio: '',
      note: '',
    });
  }
  const otherNote = others.length
    ? ` ${others.length} other crawled ${
        others.length === 1 ? 'page is' : 'pages are'
      } also under ${THIN_WORD_COUNT} words (listed, not judged).`
    : '';
  return {
    score: thin ? 0 : 1,
    displayValue: `${audited.wordCount} ${audited.wordCount === 1 ? 'word' : 'words'}`,
    explanation: thin
      ? `The audited page has ${audited.wordCount} words of visible text in its HTML, under the ${THIN_WORD_COUNT} this audit treats as thin. Add substantive content, or noindex the page if it is not meant to rank.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(headings, items),
  };
}

export {buildThinContentProduct, THIN_WORD_COUNT, MAX_ROWS};
