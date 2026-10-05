/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `answer-structure` audit: common signals that make a page easy
 * for an answer engine (or a person skimming) to quote, read from the page, never judged. There is no official
 * rule for what makes a page citable, so this only describes: whether the text is in the HTML without JavaScript,
 * which landmarks it uses, how its headings are laid out, how many question-style headings have a short answer
 * right after them, how many lists and tables it has, whether Q&A structured data and an llms.txt exist.
 * Never fails. No I/O, never throws.
 */

import {extractTypedEntities} from './json-ld-graph.js';
import {snapshotOf} from './rendering.js';
import {clip, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/content-structure.js').ContentStructureArtifact} ContentStructureArtifact */

const SHORT_ANSWER_WORDS = 60;
const QA_TYPES = new Set(['FAQPage', 'QAPage', 'HowTo']);
/**
 * @param {number} n
 * @param {string} noun
 * @return {string}
 */
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

const NOTE =
  'Descriptive only. There is no official rule for what makes a page citable by an answer engine; these are common signals that make a page easy to quote.';

/**
 * @param {unknown} raw
 * @param {unknown} rendered
 * @param {string} url
 * @return {string}
 */
function textInHtml(raw, rendered, url) {
  const renderedHtml =
    rendered && typeof rendered === 'object' ? /** @type {any} */ (rendered) : null;
  const a = snapshotOf(raw, url);
  const b = renderedHtml ? snapshotOf(renderedHtml.html, url, !!renderedHtml.truncated) : null;
  if (!a || !b || b.words < 30) return 'not measured';
  const share = Math.min(1, a.words / b.words);
  const pct = Math.round(share * 100);
  if (share >= 0.9) return `yes, all of it (${pct}% of the words are in the HTML)`;
  if (share >= 0.5) return `mostly (${pct}% of the words are in the HTML)`;
  if (share > 0.2) return `partly (${pct}% of the words are in the HTML)`;
  return `little (${pct}% of the words are in the HTML; the rest is built by JavaScript)`;
}

/**
 * @param {Array<{level: number}>} headings
 * @return {number}
 */
function skippedLevels(headings) {
  let skipped = 0;
  let previous = 0;
  for (const h of headings) {
    if (previous > 0 && h.level > previous + 1) skipped++;
    previous = h.level;
  }
  return skipped;
}

/**
 * @param {unknown} jsonLd StructuredDataJsonLd artifact
 * @return {string[]}
 */
function qaTypesOf(jsonLd) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const block of Array.isArray(jsonLd) ? jsonLd.slice(0, 20) : []) {
    if (!block || typeof block.content !== 'string') continue;
    for (const entity of extractTypedEntities(block.content)) {
      if (QA_TYPES.has(entity.type)) found.add(entity.type);
    }
  }
  return [...found];
}

/**
 * @param {unknown} structure ContentStructure artifact
 * @param {{raw: unknown, rendered: unknown, url: string, jsonLd: unknown, llms: any}} extra
 * @return {Product}
 */
function buildAnswerStructureProduct(structure, {raw, rendered, url, jsonLd, llms}) {
  const s = /** @type {ContentStructureArtifact} */ (structure);
  if (!s || typeof s !== 'object' || !Array.isArray(s.headings) || !s.landmarks) {
    return notApplicable('The page structure was not collected.');
  }
  const questions = Array.isArray(s.questions) ? s.questions : [];
  const answered = questions.filter(
    q => q && q.answer !== 'none' && q.answerWords > 0 && q.answerWords <= SHORT_ANSWER_WORDS
  ).length;
  const h1 = s.headings.filter(h => h.level === 1).length;
  const lm = s.landmarks;
  const landmarkText = [
    `main: ${lm.main > 0 ? 'yes' : 'no'}`,
    `article: ${lm.article}`,
    `nav: ${lm.nav}`,
    `header: ${lm.header}`,
    `footer: ${lm.footer}`,
    `section: ${lm.section}`,
  ].join(', ');
  const inHtml = textInHtml(raw, rendered, url);
  const qa = qaTypesOf(jsonLd);
  const llmsState = llms && typeof llms === 'object' ? llms.state : null;
  /** @type {Array<Record<string, string>>} */
  const rows = [
    {signal: 'Text in the HTML without JavaScript', found: inHtml},
    {signal: 'Landmarks', found: landmarkText},
    {
      signal: 'Heading outline',
      found: `${h1} h1, ${s.headings.length} headings in all, ${skippedLevels(
        s.headings
      )} skipped ${skippedLevels(s.headings) === 1 ? 'level' : 'levels'}`,
    },
    {
      signal: 'Question-style headings',
      found: questions.length
        ? `${questions.length}, ${answered} with a short answer (up to ${SHORT_ANSWER_WORDS} words) right after`
        : 'none',
    },
    {
      signal: 'Lists, tables and definition lists',
      found: `${plural(s.lists, 'list')}, ${plural(s.tables, 'table')}, ${plural(
        s.definitionLists,
        'definition list'
      )}`,
    },
    {signal: 'Q&A structured data', found: qa.length ? qa.join(', ') : 'none'},
    {
      signal: 'llms.txt',
      found: llmsState === 'present' ? 'present' : llmsState === 'absent' ? 'absent' : 'unknown',
    },
  ];
  for (const q of questions.slice(0, 8)) {
    rows.push({
      signal: 'Question',
      found: `${clip(q.question, 90)} (answer: ${q.answer}${
        q.answerWords ? `, ${q.answerWords} words` : ''
      })`,
    });
  }
  rows.push({signal: 'Note', found: NOTE});
  return {
    score: 1,
    displayValue: `Text in HTML: ${inHtml.split(' (')[0]}; ${questions.length} question ${
      questions.length === 1 ? 'heading' : 'headings'
    }; main landmark: ${lm.main > 0 ? 'yes' : 'no'}`,
    details: table(rows, [
      ['signal', 'Signal'],
      ['found', 'What was found'],
    ]),
  };
}

export {buildAnswerStructureProduct, textInHtml, skippedLevels, qaTypesOf, SHORT_ANSWER_WORDS};
