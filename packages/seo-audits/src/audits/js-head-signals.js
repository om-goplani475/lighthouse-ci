/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildHeadSignalsProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'Title, description, canonical and robots are the same without JavaScript',
  failureTitle: 'JavaScript creates or changes the title, description, canonical or robots',
  description:
    'Fails when the page title, meta description, canonical URL or noindex in the raw HTML (what Chrome received) is missing or different from the one the page has after JavaScript runs. A crawler may index either version, and Google may not apply a noindex or canonical that JavaScript changes.',
};

class JsHeadSignals extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'js-head-signals',
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
    return buildHeadSignalsProduct(
      artifacts.MainDocumentContent,
      artifacts.RenderedHtml,
      artifacts.URL.finalDisplayedUrl
    );
  }
}

export default JsHeadSignals;
export {UIStrings};
