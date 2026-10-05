/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `keyword-alignment` audit: which main words the page title, its
 * first `<h1>` and its URL share. Descriptive only (decision with the developer): it gives no advice about keyword
 * density and never fails. A short English stop-word list is removed; other languages are compared as written.
 * No I/O, never throws.
 */

import {clip, hasContent, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_ROWS = 20;
const STOP_WORDS = new Set(
  'a an and are as at be by for from has have how in is it its of on or our that the this to was we what when where which who why with you your'.split(
    ' '
  )
);

/**
 * @param {string} text
 * @return {Set<string>} Lower-case words of 3 or more letters, stop words removed, a plural "s" folded.
 */
function wordsOf(text) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const raw of text.toLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) || []) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
  }
  return out;
}

/**
 * @param {string} url
 * @return {string} The path of the URL as words ("/blog/red-running-shoes.html" becomes "blog red running shoes").
 */
function slugOf(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return path.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_/.+]+/g, ' ');
  } catch {
    return '';
  }
}

/**
 * @param {unknown} content PageContent artifact
 * @return {Product}
 */
function buildKeywordAlignmentProduct(content) {
  if (!hasContent(content)) return notApplicable('The page content was not collected.');
  const title = wordsOf(typeof content.title === 'string' ? content.title : '');
  const h1 = wordsOf(
    Array.isArray(content.h1) && typeof content.h1[0] === 'string' ? content.h1[0] : ''
  );
  const url = wordsOf(typeof content.url === 'string' ? slugOf(content.url) : '');
  const present = [title, h1, url].filter(s => s.size > 0).length;
  if (present < 2) {
    return notApplicable(
      'At least two of the title, the first h1 and the URL path need words to compare.'
    );
  }
  const all = new Set([...title, ...h1, ...url]);
  const rows = [...all]
    .map(word => ({
      word,
      title: title.has(word),
      h1: h1.has(word),
      url: url.has(word),
    }))
    .map(r => ({...r, count: Number(r.title) + Number(r.h1) + Number(r.url)}))
    .filter(r => r.count >= 2)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  const inAll = rows.filter(r => r.count === 3).length;
  const mark = (/** @type {boolean} */ yes) => (yes ? 'yes' : '');
  if (rows.length === 0) {
    return {
      score: 1,
      displayValue: 'No main word is shared by two of the title, the h1 and the URL',
      details: table(
        [
          {source: 'Title', words: clip([...title].join(' ') || '(none)', 100)},
          {source: 'First h1', words: clip([...h1].join(' ') || '(none)', 100)},
          {source: 'URL path', words: clip([...url].join(' ') || '(none)', 100)},
        ],
        [
          ['source', 'Source'],
          ['words', 'Main words'],
        ]
      ),
    };
  }
  return {
    score: 1,
    displayValue: `${inAll} ${inAll === 1 ? 'word is' : 'words are'} in all three, ${
      rows.length - inAll
    } in two`,
    details: table(
      rows
        .slice(0, MAX_ROWS)
        .map(r => ({word: r.word, title: mark(r.title), h1: mark(r.h1), url: mark(r.url)})),
      [
        ['word', 'Word'],
        ['title', 'In the title'],
        ['h1', 'In the first h1'],
        ['url', 'In the URL'],
      ]
    ),
  };
}

export {buildKeywordAlignmentProduct, wordsOf, slugOf};
