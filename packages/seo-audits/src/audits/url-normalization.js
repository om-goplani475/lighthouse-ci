/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildVariantProduct} from '../lib/crawl-url-variants.js';

const UIStrings = {
  title: 'No other URL form serves the audited page',
  failureTitle: 'The audited page is also served at another URL form',
  description:
    'Fails when the audited page and another crawled URL are the same resource in a different form (letter case, trailing slash, repeated slashes, an index file name, tracking or session parameters, parameter order), both answer 200 as HTML and their canonicals do not name one URL. Only variants the crawl saw can be found. Other groups are listed, not judged. This includes what url-case-variants and url-trailing-slash-variants report.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class UrlNormalization extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'url-normalization',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/crawl-url-variants.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildVariantProduct(artifacts.SiteCrawl, 'any');
  }
}

export default UrlNormalization;
export {UIStrings};
