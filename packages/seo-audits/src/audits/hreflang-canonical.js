/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildCanonicalProduct} from '../lib/hreflang-network.js';

const UIStrings = {
  title: 'Canonicals agree with the hreflang URLs',
  failureTitle: 'A canonical conflicts with the hreflang URLs',
  description:
    'Fails when this page canonical points at another language version of itself, or when an alternate version canonical is not the URL that hreflang names (hreflang should name canonical URLs). Reads the page and the alternates fetched for hreflang-return-links.',
};

class HreflangCanonical extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hreflang-canonical',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['HreflangData'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/hreflang-network.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildCanonicalProduct(artifacts.HreflangData);
  }
}

export default HreflangCanonical;
export {UIStrings};
