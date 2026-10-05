/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildRedirectingLinksProduct} from '../lib/crawl-link-checks.js';

const UIStrings = {
  title: 'Internal links point straight at their target',
  failureTitle: 'Internal links point at a permanent redirect',
  description:
    'Fails when an internal link on any crawled page points at a URL that permanently redirects once (301 or 308), because it should link to the final URL. A temporary redirect (302, 303, 307) is listed with a note and does not fail; chains of two or more redirects are internal-redirect-chains. Links are read from the server HTML of the pages the site crawl reached; a target the crawl did not ' +
    'read or check is not judged, and the result says how many. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class RedirectingInternalLinks extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'redirecting-internal-links',
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
    return buildRedirectingLinksProduct(artifacts.SiteCrawl);
  }
}

export default RedirectingInternalLinks;
export {UIStrings};
