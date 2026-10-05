/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDescriptiveAnchorsProduct} from '../lib/crawl-anchors.js';

const UIStrings = {
  title: 'Every internal link on the page has descriptive anchor text',
  failureTitle: 'Internal links on the page have generic or empty anchor text',
  description:
    'Fails when the audited page has an internal link whose anchor text is generic (click here, read more, here, learn more and similar) or empty (no text, no image alt text, no aria-label or title). Other crawled pages with such links are listed, not judged. Links are read from the server HTML of the pages the site crawl reached, so a page built by ' +
    'JavaScript is not applicable. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class DescriptiveAnchorText extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'descriptive-anchor-text',
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
    return buildDescriptiveAnchorsProduct(artifacts.SiteCrawl);
  }
}

export default DescriptiveAnchorText;
export {UIStrings};
