/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildPaginationTrapProduct} from '../lib/crawl-pagination.js';

const UIStrings = {
  title: 'Numbered series of the page',
  failureTitle: 'This page is part of an endless-looking numbered series',
  description:
    'Informational (never fails a build): flags when the crawl hit its limit of 5 query-string variants of the path of the audited page and the series was still going (rel=next keeps pointing forward), which is how an endless listing or calendar looks. No further request is made, so a very long but finite series looks the same. Read from the server HTML of the pages the site crawl reached. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class PaginationTrap extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'pagination-trap',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
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
    return buildPaginationTrapProduct(artifacts.SiteCrawl);
  }
}

export default PaginationTrap;
export {UIStrings};
