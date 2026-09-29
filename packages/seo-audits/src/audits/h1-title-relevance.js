/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'H1 shares words with the page title',
  failureTitle: 'H1 may not be relevant to the page title',
  description:
    'A weak, purely informational heuristic: does the <h1> share any significant word with the ' +
    'page <title>? No shared words *may* indicate the heading and title describe different ' +
    'things, but this is not a reliable relevance judgment — a genuinely relevant H1 can ' +
    'legitimately share zero words with its title (synonyms, rephrasing). Never treat a flagged ' +
    'row here as confirmed evidence of a problem, only as a prompt to take a look.',
};

// Common short/function words excluded from the overlap check so two texts don't "match" purely
// on words like "the"/"and" — not a linguistically complete stopword list, just enough to avoid
// the most common false-positive matches.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'is',
  'are',
  'your',
  'our',
  'you',
  'we',
  'how',
  'what',
  'why',
]);

/**
 * @param {string} text
 * @return {Set<string>}
 */
function significantWords(text) {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !STOPWORDS.has(word));
  return new Set(words);
}

// @ts-expect-error - Headings/PixelWidth aren't part of Lighthouse's own closed Artifacts type
// from an out-of-tree package — same boundary already documented in the other audits here.
class H1TitleRelevance extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'h1-title-relevance',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['Headings', 'PixelWidth'],
    };
  }

  /**
   * @param {{Headings: import('../gatherers/headings.js').HeadingsArtifact, PixelWidth: import('../gatherers/pixel-width.js').PixelWidthArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {h1Texts} = artifacts.Headings;
    const title = artifacts.PixelWidth.title;

    if (!title || h1Texts.length === 0) {
      return {score: null, notApplicable: true};
    }

    const titleWords = significantWords(title.text);

    /** @type {Array<{h1: string, message: string}>} */
    const rows = [];
    for (const h1Text of h1Texts) {
      const h1Words = significantWords(h1Text);
      const hasOverlap = [...h1Words].some(word => titleWords.has(word));
      if (!hasOverlap && h1Words.size > 0 && titleWords.size > 0) {
        rows.push({
          h1: h1Text,
          message: 'No significant words in common with the page title.',
        });
      }
    }

    if (rows.length === 0) {
      return {score: null};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'h1', valueType: 'text', label: 'H1'},
      {key: 'message', valueType: 'text', label: 'Message'},
    ];

    return {
      score: null,
      details: Audit.makeTableDetails(headings, rows),
    };
  }
}

export default H1TitleRelevance;
export {UIStrings};
