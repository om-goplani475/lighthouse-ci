/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildAnchorDiversityProduct} from '../lib/crawl-anchors.js';

const UIStrings = {
  title: 'The internal links to the page use varied anchor text',
  failureTitle: 'One anchor text makes up most of the internal links to the page',
  description:
    'Fails when one exact anchor text is 60% or more of at least 5 editorial internal links to the audited page (the homepage is not judged). Links that appear with the same anchor on at least 80% of the crawled pages are site-wide navigation (a menu, a footer) and are left out; links with no anchor text are left out too. Other crawled pages with the same pattern are listed, not judged. Counted among the pages the crawl reached. Links are read from the server HTML of the pages the site crawl reached, so a page built by ' +
    'JavaScript is not applicable. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class AnchorTextDiversity extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'anchor-text-diversity',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-anchors.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildAnchorDiversityProduct(artifacts.SiteCrawl);
  }
}

export default AnchorTextDiversity;
export {UIStrings};
