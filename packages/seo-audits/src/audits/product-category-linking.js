/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {categoryLinkingProduct} from '../lib/ecommerce.js';

const UIStrings = {
  title: 'Products are linked from category pages',
  failureTitle: 'This product is not linked from a category page',
  description:
    'Advice, not a failure (a partial score). A category page is a crawled page that links to 3 or more product pages. ' +
    'Warns when the audited product page is linked from none of them; other unlinked products are listed. Judged only when ' +
    'the crawl saw the whole site (as orphan-pages), and not for a page built by script. Our judgement, not a Google requirement.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ProductCategoryLinking extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'product-category-linking',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ecommerce.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return categoryLinkingProduct(artifacts.SiteCrawl);
  }
}

export default ProductCategoryLinking;
export {UIStrings};
