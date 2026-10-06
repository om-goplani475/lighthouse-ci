/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildHeadSignalsProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'Canonical and robots are the same without JavaScript',
  failureTitle: 'JavaScript changes the canonical or robots',
  description:
    'Fails when the noindex in the raw HTML (what Chrome received) differs from the one the page has after JavaScript runs, or when the raw and rendered pages name two different canonical URLs. A title or meta description that JavaScript sets or changes is shown as a note only, because Google renders JavaScript and indexes the rendered title (a counter or a greeting differs by design). Google may not apply a noindex or canonical that JavaScript changes.',
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
    return buildHeadSignalsProduct(
      artifacts.MainDocumentContent,
      artifacts.RenderedHtml,
      artifacts.URL.finalDisplayedUrl
    );
  }
}

export default JsHeadSignals;
export {UIStrings};
