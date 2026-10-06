/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildUrlRuleProduct, RULES} from '../lib/url-quality.js';

const UIStrings = {
  title: 'The URL is not too long',
  failureTitle: 'The URL is too long',
  description:
    'Notes a URL longer than 115 characters of path and query (hard to read and share; not a Google limit) and fails only above 2,000 characters, where browsers and servers start refusing it. Other crawled URLs are listed, not judged.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class UrlLength extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'url-length',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/url-quality.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildUrlRuleProduct(artifacts.SiteCrawl, RULES.length);
  }
}

export default UrlLength;
export {UIStrings};
