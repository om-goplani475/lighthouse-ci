/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildPaginatedCanonicalProduct} from '../lib/crawl-pagination.js';

const UIStrings = {
  title: 'A paginated page does not canonicalise itself away',
  failureTitle: 'The canonical of a paginated page points at another page of its series',
  description:
    'Fails when the audited page is part of a rel=next/rel=prev series and its canonical is another page of that series (page 1 included), which hides the page and its items from indexing. A canonical outside the series, such as a view-all page, passes with a note. Other pages of the series that do the same are listed, not judged. Read from the server HTML of the pages the site crawl reached. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class PaginatedCanonical extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'paginated-canonical',
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
    return buildPaginatedCanonicalProduct(artifacts.SiteCrawl);
  }
}

export default PaginatedCanonical;
export {UIStrings};
