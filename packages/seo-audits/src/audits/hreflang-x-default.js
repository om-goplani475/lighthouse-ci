/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildXDefaultProduct} from '../lib/hreflang-static.js';

const UIStrings = {
  title: 'x-default fallback',
  description:
    'Informational: shows whether the page names an x-default version, the fallback for visitors whose language is not listed (often a language chooser). Google treats x-default as optional, so this never fails.',
};

class HreflangXDefault extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hreflang-x-default',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
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
    return buildXDefaultProduct(artifacts.HreflangData);
  }
}

export default HreflangXDefault;
export {UIStrings};
