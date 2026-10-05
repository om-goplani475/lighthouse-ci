/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `readability-score` audit: the Flesch reading ease and the
 * Flesch-Kincaid grade level of the page's main text. English only (decision with the developer): the formula is
 * calibrated on English, so a page that does not declare `lang="en"` is not applicable. The syllable count is a
 * heuristic (vowel groups, a silent final e), so the numbers are a guide, not a measurement. Never fails. No I/O,
 * never throws.
 */

import {hasContent, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MIN_WORDS = 100;
const MIN_SENTENCES = 3;
const MAX_SCAN_CHARS = 200000;
const BANDS = [
  [90, 'very easy (about 5th grade)'],
  [80, 'easy (about 6th grade)'],
  [70, 'fairly easy (about 7th grade)'],
  [60, 'plain English (about 8th to 9th grade)'],
  [50, 'fairly difficult (about 10th to 12th grade)'],
  [30, 'difficult (college level)'],
  [-Infinity, 'very difficult (university graduate level)'],
];

/**
 * A rough English syllable count.
 * @param {string} word
 * @return {number}
 */
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * @param {string} text
 * @return {{words: number, sentences: number, syllables: number}}
 */
function measure(text) {
  const clean = text.slice(0, MAX_SCAN_CHARS);
  const words = clean.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  // A sentence ends at . ! or ? followed by a space or the end; a line break also ends one (headings, list items).
  const sentences = clean.split(/(?<=[.!?])\s+|\n+/).filter(s => /[A-Za-z]{2}/.test(s)).length;
  let count = 0;
  for (const word of words) count += syllables(word);
  return {words: words.length, sentences, syllables: count};
}

/**
 * @param {unknown} content PageContent artifact
 * @return {Product}
 */
function buildReadabilityProduct(content) {
  if (!hasContent(content)) return notApplicable('The page content was not collected.');
  const lang =
    typeof content.lang === 'string' ? content.lang.trim().toLowerCase().split(/[-_]/)[0] : '';
  if (lang !== 'en') {
    return notApplicable(
      lang
        ? `The reading-ease formula is calibrated for English; this page declares lang="${lang}".`
        : 'The page does not declare its language (lang), so the English reading-ease formula is not applied.'
    );
  }
  const m = measure(content.text);
  if (m.words < MIN_WORDS || m.sentences < MIN_SENTENCES) {
    return notApplicable(
      `The main text has under ${MIN_WORDS} words or ${MIN_SENTENCES} sentences, too little to score.`
    );
  }
  const perSentence = m.words / m.sentences;
  const perWord = m.syllables / m.words;
  const ease = 206.835 - 1.015 * perSentence - 84.6 * perWord;
  const grade = 0.39 * perSentence + 11.8 * perWord - 15.59;
  const band = BANDS.find(([min]) => ease >= /** @type {number} */ (min));
  const easeRounded = Math.round(Math.max(-50, Math.min(120, ease)));
  return {
    score: 1,
    displayValue: `Reading ease ${easeRounded}, grade ${grade.toFixed(1)}`,
    details: table(
      [
        {measure: 'Reading ease (Flesch)', value: `${easeRounded}: ${band ? band[1] : ''}`},
        {measure: 'Grade level (Flesch-Kincaid)', value: grade.toFixed(1)},
        {measure: 'Words', value: String(m.words)},
        {measure: 'Sentences', value: String(m.sentences)},
        {measure: 'Words per sentence', value: perSentence.toFixed(1)},
        {measure: 'Syllables per word', value: perWord.toFixed(2)},
        {
          measure: 'Note',
          value:
            'A guide for English prose; lists, menus and technical text score oddly, and the syllable count is approximate.',
        },
      ],
      [
        ['measure', 'Measure'],
        ['value', 'Value'],
      ]
    ),
  };
}

export {buildReadabilityProduct, measure, syllables, MIN_WORDS};
