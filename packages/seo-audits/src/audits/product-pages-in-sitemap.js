/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {productSitemapProduct} from '../lib/ecommerce.js';

const UIStrings = {
  title: 'Product pages are listed in a sitemap',
  failureTitle: 'This product page is not in a sitemap',
  description:
    'Advice, not a failure (a partial score). Compares the crawled product pages (200 status, not noindex, with Product ' +
    "markup) with the URLs in the site's sitemaps. As the other cross-page audits, the audited page is judged and the " +
    'others are listed. Not applicable when there is no crawl, no product page, or no sitemap that was read in full (a page ' +
    'cannot be called missing from a sitemap that was cut short). Our judgement, not a Google requirement.',
};

// @ts-expect-error - SiteCrawl and SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ProductPagesInSitemap extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'product-pages-in-sitemap',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl', 'SitemapDocuments'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ecommerce.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact, SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return productSitemapProduct(artifacts.SiteCrawl, artifacts.SitemapDocuments);
  }
}

export default ProductPagesInSitemap;
export {UIStrings};
