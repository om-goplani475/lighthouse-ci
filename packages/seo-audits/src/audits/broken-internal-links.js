/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildBrokenLinksProduct} from '../lib/crawl-link-checks.js';

const UIStrings = {
  title: 'No internal link points at a page that is broken',
  failureTitle: 'Internal links point at pages that are broken',
  description:
    'Fails when an internal link on any crawled page points at a page that answers 4xx or 5xx, or does not answer. Links on the audited page that the crawl did not read are status-checked too (up to 100, no bodies read; LHCI_SEO_CRAWL_MAX_LINK_CHECKS). Links are read from the server HTML of the pages the site crawl reached; a target the crawl did not ' +
    'read or check is not judged, and the result says how many. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class BrokenInternalLinks extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'broken-internal-links',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-link-checks.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildBrokenLinksProduct(artifacts.SiteCrawl);
  }
}

export default BrokenInternalLinks;
export {UIStrings};
