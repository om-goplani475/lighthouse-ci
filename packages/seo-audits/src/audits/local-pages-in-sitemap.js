/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {localSitemapProduct} from '../lib/local.js';

const UIStrings = {
  title: 'Local business pages are listed in a sitemap',
  failureTitle: 'This local business page is not in a sitemap',
  description:
    "Advice, not a failure (a partial score). Compares the crawled local business pages (status 200, not noindex, with local business markup) with the site's sitemaps; the audited page is judged and the others are listed. Not applicable when there is no crawl, no local page, or no sitemap that was read in full. Our judgement, not a Google requirement.",
};

// @ts-expect-error - SiteCrawl and SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class LocalPagesInSitemap extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'local-pages-in-sitemap',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl', 'SitemapDocuments'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/local.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact, SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return localSitemapProduct(artifacts.SiteCrawl, artifacts.SitemapDocuments);
  }
}

export default LocalPagesInSitemap;
export {UIStrings};
