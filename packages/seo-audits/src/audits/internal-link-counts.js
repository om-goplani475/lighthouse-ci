/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildLinkCountsProduct} from '../lib/crawl-link-audits.js';

const UIStrings = {
  title: 'Internal link counts',
  failureTitle: 'The page has an unusual number of internal links',
  description:
    'Informational (never fails a build): flags when the audited page has more than 150 internal links on it, or exactly one crawled page linking to it (fewer than 2; none at all is orphan-pages). The low side is only judged when the crawl saw the whole site, since a link from a page it did not read would be missed. Other pages outside the thresholds are listed, not judged. Links are read from the server HTML of the pages the site crawl reached, so a page built by ' +
    'JavaScript is not applicable. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class InternalLinkCounts extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'internal-link-counts',
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
    return buildLinkCountsProduct(artifacts.SiteCrawl);
  }
}

export default InternalLinkCounts;
export {UIStrings};
