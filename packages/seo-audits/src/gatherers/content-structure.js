/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Collects the structure of the page's main content for the `answer-structure` report: its headings, how many
 * lists, tables and definition lists it has, which landmarks it uses, and, for each heading written as a question,
 * how long the answer right after it is. Rule-agnostic: the report is built in lib/ai-structure.js. No request.
 * Capped everywhere so a huge page cannot grow the artifact.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';

/* eslint-env browser */

/**
 * @typedef {{
 *   headings: Array<{level: number, text: string}>,
 *   paragraphs: number,
 *   lists: number,
 *   tables: number,
 *   definitionLists: number,
 *   landmarks: {main: number, article: number, nav: number, header: number, footer: number, section: number, aside: number},
 *   questions: Array<{question: string, answer: 'paragraph' | 'list' | 'table' | 'none', answerWords: number}>,
 * }} ContentStructureArtifact
 */

/* c8 ignore start */
function collectContentStructure() {
  const clip = (/** @type {string} */ s, /** @type {number} */ n) =>
    s.replace(/\s+/g, ' ').trim().slice(0, n);
  const count = (/** @type {string} */ selector) =>
    Math.min(document.querySelectorAll(selector).length, 9999);
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .slice(0, 80)
    .map(h => ({level: Number(h.tagName.charAt(1)), text: clip(h.textContent || '', 120)}));

  /** @type {Array<{question: string, answer: 'paragraph' | 'list' | 'table' | 'none', answerWords: number}>} */
  const questions = [];
  for (const h of Array.from(document.querySelectorAll('h2, h3, h4')).slice(0, 200)) {
    const text = clip(h.textContent || '', 160);
    if (!text.endsWith('?')) continue;
    const next = h.nextElementSibling;
    /** @type {'paragraph' | 'list' | 'table' | 'none'} */
    let answer = 'none';
    let words = 0;
    if (next) {
      const tag = next.tagName.toLowerCase();
      if (tag === 'p') answer = 'paragraph';
      else if (tag === 'ul' || tag === 'ol') answer = 'list';
      else if (tag === 'table') answer = 'table';
      if (answer !== 'none') {
        words = clip(next.textContent || '', 4000)
          .split(' ')
          .filter(Boolean).length;
      }
    }
    questions.push({question: text, answer, answerWords: words});
    if (questions.length >= 30) break;
  }

  return {
    headings,
    paragraphs: count('p'),
    lists: count('ul, ol'),
    tables: count('table'),
    definitionLists: count('dl'),
    landmarks: {
      main: count('main, [role="main"]'),
      article: count('article'),
      nav: count('nav, [role="navigation"]'),
      header: count('header'),
      footer: count('footer'),
      section: count('section'),
      aside: count('aside'),
    },
    questions,
  };
}
/* c8 ignore stop */

class ContentStructure extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<ContentStructureArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    return passContext.driver.executionContext.evaluate(collectContentStructure, {
      args: [],
      useIsolation: true,
      deps: [],
    });
  }
}

export default ContentStructure;
