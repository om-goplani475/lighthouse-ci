/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildReadabilityProduct} from '../lib/content-readability.js';

const UIStrings = {
  title: 'Reading ease of the main text',
  description:
    'Informational: the Flesch reading ease and Flesch-Kincaid grade level of the main text. English only: a page that does not declare lang="en" is not applicable. The syllable count is a heuristic, so the numbers are a guide. Needs at least 100 words and 3 sentences. Never fails.',
};

class ReadabilityScore extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'readability-score',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['PageContent'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/content-readability.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildReadabilityProduct(artifacts.PageContent);
  }
}

export default ReadabilityScore;
export {UIStrings};
