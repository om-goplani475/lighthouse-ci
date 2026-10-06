/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {napProduct} from '../lib/local.js';

const UIStrings = {
  title: 'A local business shows one name, address and phone',
  failureTitle: 'A local business shows inconsistent addresses or phone numbers',
  description:
    'Advice, not a failure (a partial score). Compares the local businesses in the markup of the crawled pages and warns when one business (the same @id) shows two phone numbers or two addresses, or when two pages with the same name agree on one of phone and address and differ on the other. A site with several locations is not flagged: the same name at a different address and a different phone is another location. As the other cross-page audits, the audited page is judged and the others are listed. Our judgement (consistent name, address and phone is standard local SEO practice), not a Google requirement.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class LocalNapConsistency extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'local-nap-consistency',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/local.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return napProduct(artifacts.SiteCrawl);
  }
}

export default LocalNapConsistency;
export {UIStrings};
