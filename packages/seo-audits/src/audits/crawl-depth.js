/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildCrawlDepthProduct} from '../lib/crawl-link-audits.js';

const UIStrings = {
  title: 'Click depth from the homepage',
  failureTitle: 'The page is more than 3 clicks from the homepage',
  description:
    'Informational (never fails a build): flags when the audited page needs more than 3 clicks from the homepage, along the followable links the crawl saw. A depth within the limit is always reliable; a larger one is only judged when the crawl saw the whole site, since a shorter path may run through a page not crawled. Links are read from the server HTML of the pages the site crawl reached, so a page built by ' +
    'JavaScript is not applicable. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class CrawlDepth extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'crawl-depth',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-link-audits.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildCrawlDepthProduct(artifacts.SiteCrawl);
  }
}

export default CrawlDepth;
export {UIStrings};
