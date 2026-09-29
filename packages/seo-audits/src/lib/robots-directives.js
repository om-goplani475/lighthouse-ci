/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure parsing for robots meta tag / X-Robots-Tag header directives — used by both
 * robots-directives-report and robots-directives-conflict, kept as one module so the two audits
 * can't silently drift on what counts as a valid directive or how a value-bearing one is parsed.
 * Deliberately imports only `lighthouse/core/audits/audit.js` (safe — confirmed directly
 * `require()`-able under Jest), never `./robots-sources.js` or anything that touches
 * `MainResource`/`NetworkRequest`, which transitively hit `import.meta.url` and can't load under
 * Jest. This file also holds both audits' pure result-building logic (`buildReportResult`,
 * `buildConflictResult`) for exactly that reason — keeping them here, not in the audit files
 * themselves (which do import ./robots-sources.js), is what lets them be unit-tested directly.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

// Directives that block indexing outright — used by robots-directives-conflict to decide whether
// the two sources agree on indexability, the one thing worth failing a build over.
const INDEX_BLOCKING_DIRECTIVES = new Set(['noindex', 'none']);

/** @type {Record<string, string>} */
const PLAIN_EXPLANATIONS = {
  index:
    'This page may be included in search results (the default; explicitly stating it has ' +
    'no additional effect).',
  noindex: 'This page will not be included in search results.',
  follow:
    'Search engines may follow links on this page to discover other linked pages (the ' +
    'default; explicitly stating it has no additional effect).',
  nofollow: 'Search engines will not follow links on this page to discover other linked pages.',
  none: 'Equivalent to noindex, nofollow — combines both.',
  all:
    'Equivalent to index, follow — combines both (the default; explicitly stating it has no ' +
    'additional effect).',
  nosnippet: 'No text snippet or video preview will be shown for this page in search results.',
  noarchive: 'Search engines will not store a cached copy of this page.',
  notranslate: 'Search engines will not offer to translate this page in search results.',
  noimageindex: 'Images on this page will not be indexed.',
};

/**
 * @param {string} key
 * @param {string | undefined} value
 * @return {string | null} plain-English explanation, or null if the token isn't recognized
 */
function explainDirective(key, value) {
  if (key === 'max-snippet') {
    return (
      `Limits the text snippet shown in search results to at most ${value ?? '?'} characters ` +
      '(0 = no snippet, -1 = no limit).'
    );
  }
  if (key === 'max-image-preview') {
    return `Limits image previews in search results to the "${value ?? '?'}" size setting.`;
  }
  if (key === 'max-video-preview') {
    return (
      `Limits video previews in search results to at most ${value ?? '?'} seconds ` +
      '(0 = static image only, -1 = no limit).'
    );
  }
  return PLAIN_EXPLANATIONS[key] ?? null;
}

/**
 * @typedef {{raw: string, key: string, value: string | undefined, explanation: string | null}} RobotsDirective
 */

/**
 * @param {string | undefined | null} content
 * @return {RobotsDirective[]}
 */
function parseDirectives(content) {
  if (!content) return [];
  return content
    .split(',')
    .map(token => token.trim())
    .filter(Boolean)
    .map(raw => {
      const [key, value] = raw
        .toLowerCase()
        .split(':')
        .map(part => part.trim());
      return {raw, key, value, explanation: explainDirective(key, value)};
    });
}

/**
 * @param {RobotsDirective[]} directives
 * @return {boolean}
 */
function blocksIndexing(directives) {
  return directives.some(d => INDEX_BLOCKING_DIRECTIVES.has(d.key));
}

/**
 * @param {{metaContent: string | undefined, headerValue: string | undefined}} sources
 * @return {import('lighthouse/types/audit.js').default.Product}
 */
function buildReportResult({metaContent, headerValue}) {
  const metaDirectives = parseDirectives(metaContent).map(d => ({...d, source: 'meta robots'}));
  const headerDirectives = parseDirectives(headerValue).map(d => ({
    ...d,
    source: 'X-Robots-Tag header',
  }));
  const rows = [...metaDirectives, ...headerDirectives];

  if (rows.length === 0) {
    return {score: null, notApplicable: true};
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'source', valueType: 'text', label: 'Source'},
    {key: 'raw', valueType: 'text', label: 'Directive'},
    {key: 'explanation', valueType: 'text', label: 'Implication'},
  ];

  const items = rows.map(row => ({
    source: row.source,
    raw: row.raw,
    explanation: row.explanation ?? 'Not a recognized robots directive — likely a typo.',
  }));

  return {
    score: null,
    details: Audit.makeTableDetails(headings, items),
  };
}

/**
 * @param {{metaContent: string | undefined, headerValue: string | undefined}} sources
 * @return {import('lighthouse/types/audit.js').default.Product}
 */
function buildConflictResult({metaContent, headerValue}) {
  // Only meaningful to compare when both sources actually say something — a page with only a
  // meta tag (no header) or only a header (no meta tag) has nothing to conflict with, and that's
  // the normal case for the vast majority of pages.
  if (!metaContent || !headerValue) {
    return {score: null, notApplicable: true};
  }

  const metaBlocks = blocksIndexing(parseDirectives(metaContent));
  const headerBlocks = blocksIndexing(parseDirectives(headerValue));

  if (metaBlocks === headerBlocks) {
    return {score: 1};
  }

  return {
    score: 0,
    explanation:
      `The meta robots tag ${metaBlocks ? 'blocks' : 'does not block'} indexing ` +
      `("${metaContent}"), but the X-Robots-Tag header ${
        headerBlocks ? 'blocks' : 'does not block'
      } ` +
      `indexing ("${headerValue}"). Google will honor the more restrictive of the two.`,
  };
}

export {
  parseDirectives,
  blocksIndexing,
  buildReportResult,
  buildConflictResult,
  INDEX_BLOCKING_DIRECTIVES,
};
