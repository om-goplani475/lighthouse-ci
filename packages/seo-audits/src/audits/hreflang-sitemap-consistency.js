/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildSitemapProduct} from '../lib/hreflang-sitemap.js';

const UIStrings = {
  title: 'hreflang in the page and in the sitemap',
  description:
    'Informational: compares the hreflang links of the page with the xhtml:link alternates the sitemap lists for the same URL, and lists the differences. A site may use either place or both, so this never fails. Only the sitemap files that were read are searched.',
};

class HreflangSitemapConsistency extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hreflang-sitemap-consistency',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['HreflangData', 'SitemapDocuments'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/hreflang-sitemap.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildSitemapProduct(artifacts.HreflangData, artifacts.SitemapDocuments);
  }
}

export default HreflangSitemapConsistency;
export {UIStrings};
