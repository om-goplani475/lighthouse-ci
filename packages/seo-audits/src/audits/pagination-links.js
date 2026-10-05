/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildPaginationLinksProduct} from '../lib/crawl-pagination.js';

const UIStrings = {
  title: 'The rel=next and rel=prev links work and agree',
  failureTitle: 'The rel=next or rel=prev links are broken or inconsistent',
  description:
    'Fails when the audited page has a rel=next or rel=prev link whose target is broken, is the page itself or does not link back, or when the rel=next chain loops. A redirecting target is a note. The targets are status-checked even when the crawl did not read them. Other crawled pages with problems are listed, not judged. Google no longer uses rel=next/prev, but other search engines and tools do. Read from the server HTML of the pages the site crawl reached. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class PaginationLinks extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'pagination-links',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-pagination.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildPaginationLinksProduct(artifacts.SiteCrawl);
  }
}

export default PaginationLinks;
export {UIStrings};
