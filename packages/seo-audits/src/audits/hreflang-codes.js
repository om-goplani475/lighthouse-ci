/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildCodesProduct} from '../lib/hreflang-static.js';

const UIStrings = {
  title: 'hreflang values are valid and the page lists itself',
  failureTitle: 'hreflang values are invalid or the page does not list itself',
  description:
    'Fails when an hreflang value is not a valid language code with an optional region (for example en-UK, eng, en_US or a bare country code, which Core only partly checks), when the page does not list itself, or when one value points at two different URLs. Reads the hreflang links in the head. Not applicable when the page declares no hreflang.',
};

class HreflangCodes extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hreflang-codes',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['HreflangData'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/hreflang-static.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildCodesProduct(artifacts.HreflangData);
  }
}

export default HreflangCodes;
export {UIStrings};
