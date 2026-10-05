/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildVariantProduct} from '../lib/crawl-url-variants.js';

const UIStrings = {
  title: 'No URL exists in two letter-case forms',
  failureTitle: 'Another crawled URL differs only in letter case',
  description:
    'Fails when the audited page and another crawled URL differ only in upper and lower case, both answer 200 as HTML and their canonicals do not name one URL. Only variants the crawl saw (linked from a page or in the sitemap) can be found; a variant that redirects is not a problem. Other groups are listed, not judged.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class UrlCaseVariants extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'url-case-variants',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/crawl-url-variants.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildVariantProduct(artifacts.SiteCrawl, 'case');
  }
}

export default UrlCaseVariants;
export {UIStrings};
