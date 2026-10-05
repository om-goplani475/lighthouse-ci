/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildUrlRuleProduct, RULES} from '../lib/url-quality.js';

const UIStrings = {
  title: 'The URL has few query parameters',
  failureTitle: 'The URL has too many query parameters',
  description:
    'Fails when the audited page URL has more than 3 query parameters, which tends to create many URLs for one page. Other crawled URLs are listed, not judged.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class UrlQueryParameters extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'url-query-parameters',
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
    return buildUrlRuleProduct(artifacts.SiteCrawl, RULES.params);
  }
}

export default UrlQueryParameters;
export {UIStrings};
