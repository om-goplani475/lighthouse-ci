/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildRedirectChainsProduct} from '../lib/crawl-link-checks.js';

const UIStrings = {
  title: 'No internal link goes through a redirect chain',
  failureTitle: 'Internal links go through a redirect chain or loop',
  description:
    'Fails when an internal link on any crawled page points at a URL that redirects two or more times, or in a circle, whatever the statuses. A single redirect is redirecting-internal-links. Links are read from the server HTML of the pages the site crawl reached; a target the crawl did not ' +
    'read or check is not judged, and the result says how many. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class InternalRedirectChains extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'internal-redirect-chains',
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
    return buildRedirectChainsProduct(artifacts.SiteCrawl);
  }
}

export default InternalRedirectChains;
export {UIStrings};
