/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `placeholder-content` audit: leftover filler text on the page. Fails on a clear
 * mistake only (chosen with the developer): "lorem ipsum" filler, template prompts such as "your text here", and
 * template tags that were never filled in (`{{ name }}`). Code samples (`pre`, `code`, `kbd`, `samp`) are not read:
 * a tutorial showing a template tag is not leftover filler. The title is still read. Words such as "coming soon" or "sample" are not matched,
 * because they are ordinary text. A page that is itself about lorem ipsum or a template tool would be flagged:
 * that is accepted and noted in the description. No I/O, never throws.
 */

import {clip, hasContent, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_SCAN_CHARS = 200000;
/** @type {Array<[RegExp, string]>} */
const PATTERNS = [
  [/lorem ipsum|dolor sit amet|consectetur adipiscing/i, 'lorem ipsum filler text'],
  [
    /\b(your|insert|enter|add) (text|title|content|description|headline|name|copy) here\b/i,
    'a template prompt ("your text here")',
  ],
  [
    /\b(page|post|site) title goes here\b|\bclick (here )?to edit (this )?(text|title|heading)\b/i,
    'an unedited template prompt',
  ],
  [/\{\{[^{}\n]{1,80}\}\}/, 'an unfilled template tag ({{ ... }})'],
  [/<%[=-]?[^%\n]{1,60}%>/, 'an unfilled template tag (<% ... %>)'],
];

/**
 * @param {string} text
 * @param {number} index
 * @return {string}
 */
function around(text, index) {
  const start = Math.max(0, index - 40);
  return clip(
    text
      .slice(start, index + 80)
      .replace(/\s+/g, ' ')
      .trim(),
    120
  );
}

/**
 * @param {unknown} content PageContent artifact
 * @return {Product}
 */
function buildPlaceholderProduct(content) {
  if (!hasContent(content)) return notApplicable('The page content was not collected.');
  const body = typeof content.proseText === 'string' ? content.proseText : content.text;
  const text = `${content.title || ''}\n${body}`.slice(0, MAX_SCAN_CHARS);
  if (text.trim() === '') return notApplicable('The page has no text to check.');
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  for (const [pattern, kind] of PATTERNS) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    );
    let first = -1;
    let count = 0;
    let match;
    while ((match = global.exec(text)) !== null) {
      if (first === -1) first = match.index;
      if (++count >= 50 || match[0] === '') break;
    }
    if (count > 0) {
      rows.push({
        kind: count > 1 ? `${kind} (${count >= 50 ? '50 or more' : count} matches)` : kind,
        text: around(text, first),
      });
    }
  }
  if (rows.length === 0) return {score: 1, displayValue: 'No placeholder text found'};
  return {
    score: 0,
    displayValue: `${rows.length} ${rows.length === 1 ? 'piece' : 'pieces'} of placeholder text`,
    explanation:
      'The page contains filler or an unfilled template: it was probably published before its real content was written. Visitors and search engines treat such a page as low quality. Replace the placeholder text.',
    details: table(rows, [
      ['kind', 'What it looks like'],
      ['text', 'Where'],
    ]),
  };
}

export {buildPlaceholderProduct, PATTERNS};
