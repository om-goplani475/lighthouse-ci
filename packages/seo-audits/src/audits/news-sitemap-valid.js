/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {newsSitemapValidProduct} from '../lib/news.js';

const UIStrings = {
  title: 'The Google News sitemap is valid',
  failureTitle: 'The Google News sitemap has invalid entries',
  description:
    'Fails when an entry of a Google News sitemap (news:news) is missing a tag Google requires (news:publication with news:name and news:language, news:publication_date, news:title), has a language that is not an ISO 639 code (zh-cn and zh-tw for Chinese), a publication date that is not in an accepted form (YYYY-MM-DD, or with a time and timezone), or when the sitemap has more than 1,000 news entries. A title that contains the publication name is a note. Not applicable when no news sitemap was found among the sitemaps read (the declared ones and the children of a sitemap index, up to 10 files).',
};

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class NewsSitemapValid extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'news-sitemap-valid',
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
    return newsSitemapValidProduct(artifacts.SitemapDocuments);
  }
}

export default NewsSitemapValid;
export {UIStrings};
