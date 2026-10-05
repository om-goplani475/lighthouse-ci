/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildContentProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'The page text is in the raw HTML',
  failureTitle: 'Most of the page text appears only after JavaScript',
  description:
    'Fails when more than half of the words of the rendered page are missing from the raw HTML. Pages with under 50 rendered words are not judged. Both sides are read with the same HTML extractor.',
};

class JsVisibleContent extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'js-visible-content',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['MainDocumentContent', 'RenderedHtml', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/rendering.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildContentProduct(
      artifacts.MainDocumentContent,
      artifacts.RenderedHtml,
      artifacts.URL.finalDisplayedUrl
    );
  }
}

export default JsVisibleContent;
export {UIStrings};
