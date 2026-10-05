/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildKeywordAlignmentProduct} from '../lib/content-keywords.js';

const UIStrings = {
  title: 'Words shared by the title, the h1 and the URL',
  description:
    'Informational and descriptive only: which main words the page title, its first h1 and its URL path share. No keyword density or stuffing advice, and it never fails. Short English stop words are ignored.',
};

class KeywordAlignment extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'keyword-alignment',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['PageContent'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/content-keywords.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildKeywordAlignmentProduct(artifacts.PageContent);
  }
}

export default KeywordAlignment;
export {UIStrings};
