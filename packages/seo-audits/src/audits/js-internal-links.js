/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildLinksProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'Internal links are in the raw HTML',
  failureTitle: 'Many internal links appear only after JavaScript',
  description:
    'Warns (a partial score, not a failure) when more than 20% of the page internal links (and at least 3) exist only in the rendered DOM, not in the raw HTML. Fewer are listed as a note. A crawler that does not run JavaScript will not follow links that are not in the HTML.',
};

class JsInternalLinks extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'js-internal-links',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      supportedModes: ['navigation'],
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
    return buildLinksProduct(
      artifacts.MainDocumentContent,
      artifacts.RenderedHtml,
      artifacts.URL.finalDisplayedUrl
    );
  }
}

export default JsInternalLinks;
export {UIStrings};
