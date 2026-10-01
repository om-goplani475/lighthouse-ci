/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildCoverageProduct} from '../lib/crawl-coverage.js';

const UIStrings = {
  title: 'Site crawl coverage',
  description:
    'Shows what the site crawl saw: the audited page, its own links and the sitemap URLs (one level, ' +
    'same origin only), up to 50 pages by default, honouring robots.txt, from server HTML. The cross-page ' +
    'audits read the same crawl, so this tells you how much of the site they were judging. Informational: ' +
    'it never fails. Set LHCI_SEO_CRAWL=0 to switch the crawl off; LHCI_SEO_CRAWL_MAX_PAGES, ' +
    'LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS, LHCI_SEO_CRAWL_RESPECT_ROBOTS and the cache variables tune it. ' +
    'It sends up to about 100 requests to the audited site on a cold cache, and none when a fresh cache ' +
    'exists from another run of the same collect.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class CrawlCoverage extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'crawl-coverage',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the table and the notes are in `lib/crawl-coverage.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildCoverageProduct(artifacts.SiteCrawl);
  }
}

export default CrawlCoverage;
export {UIStrings};
