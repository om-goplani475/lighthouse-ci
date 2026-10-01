/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDuplicateProduct} from '../lib/crawl-duplicates.js';

const UIStrings = {
  title: 'The page title is unique across the crawled pages',
  failureTitle: 'Another crawled page has the same title',
  description:
    'Fails when another crawled page has the same <title> as the audited page. Compared with the other pages the site crawl reached (the audited page, its links and the ' +
    'sitemap URLs, same origin, from server HTML), equal after trimming and ignoring case. A missing ' +
    'value is not counted here. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class DuplicateTitles extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'duplicate-titles',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the comparison is in `lib/crawl-duplicates.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildDuplicateProduct(artifacts.SiteCrawl, 'title');
  }
}

export default DuplicateTitles;
export {UIStrings};
