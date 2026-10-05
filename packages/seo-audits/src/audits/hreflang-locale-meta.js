/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildLocaleMetaProduct} from '../lib/hreflang-static.js';

const UIStrings = {
  title: 'lang, content-language and og:locale versus hreflang',
  description:
    'Informational: compares the html lang attribute, the content-language meta tag and og:locale with the language and region the page declares for itself in hreflang, and lists mismatches (for example an English page marked lang="fr"). A mismatch is advice, never a failure.',
};

class HreflangLocaleMeta extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hreflang-locale-meta',
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
    return buildLocaleMetaProduct(artifacts.HreflangData);
  }
}

export default HreflangLocaleMeta;
export {UIStrings};
