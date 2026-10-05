/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildAnswerStructureProduct} from '../lib/ai-structure.js';

const UIStrings = {
  title: 'How easy the page is to quote',
  description:
    'Informational and descriptive only: common signals that make a page easy for an answer engine or a reader to quote. Whether the text is in the HTML without JavaScript, which landmarks it uses (main, article, nav), its heading outline, how many question-style headings have a short answer right after them, how many lists and tables it has, whether Q and A structured data and an llms.txt exist. There is no official rule for what makes a page citable, so this never scores or fails.',
};

class AnswerStructure extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'answer-structure',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // Several of these are custom artifacts, which Lighthouse's closed Artifacts type does not list.
      requiredArtifacts: /** @type {any} */ ([
        'ContentStructure',
        'MainDocumentContent',
        'RenderedHtml',
        'URL',
        'StructuredDataJsonLd',
        'LlmsTxt',
      ]),
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ai-structure.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildAnswerStructureProduct(artifacts.ContentStructure, {
      raw: artifacts.MainDocumentContent,
      rendered: artifacts.RenderedHtml,
      url: artifacts.URL.finalDisplayedUrl,
      jsonLd: artifacts.StructuredDataJsonLd,
      llms: artifacts.LlmsTxt,
    });
  }
}

export default AnswerStructure;
export {UIStrings};
