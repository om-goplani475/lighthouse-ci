/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildAnswerStructureProduct,
  textInHtml,
  skippedLevels,
  qaTypesOf,
  SHORT_ANSWER_WORDS,
} = require('../../src/lib/ai-structure.js');

const URL_ = 'https://example.com/guide';
const words = (/** @type {number} */ n) => Array.from({length: n}, (_, i) => `word${i}`).join(' ');
const html = (/** @type {number} */ n) =>
  `<html><head><title>t</title></head><body><main><p>${words(n)}</p></main></body></html>`;
const structure = (/** @type {any} */ over = {}) => ({
  headings: [
    {level: 1, text: 'Guide'},
    {level: 2, text: 'What is it?'},
    {level: 2, text: 'How does it work?'},
  ],
  paragraphs: 5,
  lists: 2,
  tables: 1,
  definitionLists: 0,
  landmarks: {main: 1, article: 1, nav: 2, header: 1, footer: 1, section: 3, aside: 0},
  questions: [
    {question: 'What is it?', answer: 'paragraph', answerWords: 25},
    {question: 'How does it work?', answer: 'list', answerWords: 80},
  ],
  ...over,
});
const extra = (/** @type {any} */ over = {}) => ({
  raw: html(200),
  rendered: {html: html(200), truncated: false},
  url: URL_,
  jsonLd: [],
  llms: {state: 'absent'},
  ...over,
});
const find = (/** @type {any} */ p, /** @type {string} */ signal) =>
  p.details.items.find((/** @type {any} */ i) => i.signal === signal).found;

describe('helpers', () => {
  it('measures how much of the text is in the HTML', () => {
    expect(textInHtml(html(200), {html: html(200)}, URL_)).toMatch(/^yes, all of it \(100%/);
    expect(textInHtml(html(120), {html: html(200)}, URL_)).toMatch(/^mostly \(60%/);
    expect(textInHtml(html(60), {html: html(200)}, URL_)).toMatch(/^partly \(30%/);
    expect(textInHtml(html(10), {html: html(200)}, URL_)).toMatch(/^little \(5%/);
    expect(textInHtml('', {html: html(200)}, URL_)).toBe('not measured');
    expect(textInHtml(html(200), null, URL_)).toBe('not measured');
    expect(textInHtml(html(10), {html: html(20)}, URL_)).toBe('not measured');
  });
  it('counts skipped heading levels', () => {
    expect(skippedLevels([{level: 1}, {level: 2}, {level: 3}])).toBe(0);
    expect(skippedLevels([{level: 1}, {level: 3}, {level: 6}])).toBe(2);
    expect(skippedLevels([{level: 2}, {level: 2}])).toBe(0);
  });
  it('finds Q&A structured data types, also in a graph', () => {
    const block = (/** @type {any} */ o) => ({
      content: JSON.stringify({'@context': 'https://schema.org', ...o}),
    });
    expect(
      qaTypesOf([
        block({'@type': 'FAQPage'}),
        block({'@graph': [{'@type': 'HowTo'}, {'@type': 'Article'}]}),
        {content: 'not json'},
        null,
      ])
    ).toEqual(['FAQPage', 'HowTo']);
    expect(qaTypesOf(null)).toEqual([]);
  });
});

describe('buildAnswerStructureProduct (informational)', () => {
  it('describes the page and never scores it', () => {
    const p = buildAnswerStructureProduct(structure(), extra());
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe(
      'Text in HTML: yes, all of it; 2 question headings; main landmark: yes'
    );
    expect(find(p, 'Text in the HTML without JavaScript')).toMatch(/^yes/);
    expect(find(p, 'Landmarks')).toBe(
      'main: yes, article: 1, nav: 2, header: 1, footer: 1, section: 3'
    );
    expect(find(p, 'Heading outline')).toBe('1 h1, 3 headings in all, 0 skipped levels');
    expect(find(p, 'Question-style headings')).toBe(
      `2, 1 with a short answer (up to ${SHORT_ANSWER_WORDS} words) right after`
    );
    expect(find(p, 'Lists, tables and definition lists')).toBe(
      '2 lists, 1 table, 0 definition lists'
    );
    expect(find(p, 'Q&A structured data')).toBe('none');
    expect(find(p, 'llms.txt')).toBe('absent');
  });

  it('reports Q&A markup, llms.txt, and a client-rendered page', () => {
    const p = buildAnswerStructureProduct(
      structure({
        headings: [
          {level: 1, text: 'A'},
          {level: 3, text: 'B'},
        ],
        questions: [],
        landmarks: {main: 0, article: 0, nav: 0, header: 0, footer: 0, section: 0, aside: 0},
      }),
      extra({
        raw: html(10),
        jsonLd: [{content: JSON.stringify({'@type': 'FAQPage'})}],
        llms: {state: 'present'},
      })
    );
    expect(find(p, 'Q&A structured data')).toBe('FAQPage');
    expect(find(p, 'llms.txt')).toBe('present');
    expect(find(p, 'Text in the HTML without JavaScript')).toMatch(/^little/);
    expect(find(p, 'Heading outline')).toBe('1 h1, 2 headings in all, 1 skipped level');
    expect(find(p, 'Question-style headings')).toBe('none');
    expect(p.displayValue).toMatch(/0 question headings; main landmark: no$/);
  });

  it('lists up to eight questions and ends with the note', () => {
    const questions = Array.from({length: 12}, (_, i) => ({
      question: `Q${i}?`,
      answer: 'none',
      answerWords: 0,
    }));
    const items = buildAnswerStructureProduct(structure({questions}), extra()).details.items;
    expect(items.filter((/** @type {any} */ i) => i.signal === 'Question')).toHaveLength(8);
    expect(items[items.length - 1].found).toMatch(/Descriptive only/);
  });

  it('is not applicable without the structure, and tolerates missing helpers', () => {
    expect(buildAnswerStructureProduct(null, extra()).notApplicable).toBe(true);
    expect(buildAnswerStructureProduct({headings: 5}, extra()).notApplicable).toBe(true);
    expect(
      buildAnswerStructureProduct(
        structure(),
        extra({raw: null, rendered: null, jsonLd: null, llms: null})
      ).score
    ).toBe(1);
  });
});
