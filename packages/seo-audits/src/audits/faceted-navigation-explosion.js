/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {facetedProduct} from '../lib/ecommerce.js';

const UIStrings = {
  title: 'No faceted-navigation crawl trap was seen',
  failureTitle: 'Faceted navigation creates very many URLs',
  description:
    'Advice, not a failure (a partial score). Reads the internal links the site crawl saw and warns when one path is ' +
    'linked with 20 or more different combinations of 2 or more query parameters (colour, size, sort...): the shape of a ' +
    "crawl trap that uses up a crawler's time on near-duplicate pages. Tracking, session and pagination parameters are " +
    'ignored. Our own threshold, not a Google limit. A site-level check: it does not depend on which page was audited. The ' +
    'crawl is partial, so the real number can be higher.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class FacetedNavigationExplosion extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'faceted-navigation-explosion',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ecommerce.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return facetedProduct(artifacts.SiteCrawl);
  }
}

export default FacetedNavigationExplosion;
export {UIStrings};
