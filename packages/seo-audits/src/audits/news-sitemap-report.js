/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {newsSitemapReportProduct} from '../lib/news.js';

const UIStrings = {
  title: 'The Google News sitemap is reported',
  failureTitle: 'The Google News sitemap is reported',
  description:
    'Informational (never fails a build). Summarises the news entries found: how many, in how many sitemaps, the publication names and languages, and the newest and oldest publication dates.',
};

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class NewsSitemapReport extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'news-sitemap-report',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
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
    return newsSitemapReportProduct(artifacts.SitemapDocuments);
  }
}

export default NewsSitemapReport;
export {UIStrings};
