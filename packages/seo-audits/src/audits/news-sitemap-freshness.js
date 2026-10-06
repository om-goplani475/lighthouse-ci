/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {newsSitemapFreshnessProduct} from '../lib/news.js';

const UIStrings = {
  title: 'The Google News sitemap lists only recent articles',
  failureTitle: 'The Google News sitemap lists old articles',
  description:
    'Advice, not a failure (a partial score). Google asks a news sitemap to list only articles created in the last two days and to remove older URLs (or strip their news tags). Warns when entries have a publication date more than two days before the audit. Not applicable without a news sitemap or a readable date.',
};

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class NewsSitemapFreshness extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'news-sitemap-freshness',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SitemapDocuments'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/news.js`, unit-tested there.
   * @param {{SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return newsSitemapFreshnessProduct(artifacts.SitemapDocuments);
  }
}

export default NewsSitemapFreshness;
export {UIStrings};
