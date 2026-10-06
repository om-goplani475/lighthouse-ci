/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {nameProduct} from '../lib/local.js';

const UIStrings = {
  title: 'A local business is named the same everywhere',
  failureTitle: 'A local business is named inconsistently',
  description:
    "Advice, not a failure (a partial score). Groups the crawled pages' local businesses that are the same business (same @id, same phone number or same address) and warns when they carry different names, or the same name written differently (Acme Diner and Acme Diner Inc.). As the other cross-page audits, the audited page is judged and the others are listed. Our judgement, not a Google requirement.",
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class LocalNameConsistency extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'local-name-consistency',
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
    return nameProduct(artifacts.SiteCrawl);
  }
}

export default LocalNameConsistency;
export {UIStrings};
