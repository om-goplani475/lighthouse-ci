/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `hidden-text` audit: text that is on the page but made invisible
 * by a styling trick (a font of 2 px or less, pushed off the screen, the same colour as its background, fully
 * transparent). Search engines treat a lot of such text as a spam sign. Text hidden by `display: none`, in an
 * accordion or `<details>`, or for screen readers only is ordinary and is not counted (the gatherer skips it).
 * Informational only (decision with the developer): the detection is a heuristic. Never fails. No I/O.
 */

import {clip, hasContent, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MANY_WORDS = 50;

/**
 * @param {unknown} content PageContent artifact
 * @return {Product}
 */
function buildHiddenTextProduct(content) {
  if (!hasContent(content) || typeof content.hiddenWords !== 'number') {
    return notApplicable('The hidden-text scan was not collected.');
  }
  const words = Math.max(0, Math.round(content.hiddenWords));
  if (words === 0) return {score: 1, displayValue: 'No text hidden by styling tricks found'};
  const samples = Array.isArray(content.hiddenSamples) ? content.hiddenSamples : [];
  /** @type {Array<Record<string, string>>} */
  const rows = samples.map(s => ({
    how: clip(String((s && s.reason) || ''), 80),
    text: clip(String((s && s.text) || ''), 80),
  }));
  rows.push({
    how: 'Note',
    text:
      words >= MANY_WORDS
        ? 'This is a lot of hidden text. Search engines treat text hidden from visitors as a spam sign unless it has a clear purpose; check each sample.'
        : 'A small amount; it may be a visual effect. Informational only: the detection is a heuristic.',
  });
  return {
    score: 1,
    displayValue: `${words} ${words === 1 ? 'word' : 'words'} hidden by styling`,
    details: table(rows, [
      ['how', 'How it is hidden'],
      ['text', 'Text (start)'],
    ]),
  };
}

export {buildHiddenTextProduct, MANY_WORDS};
