/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildCanonicalConflictsProduct} from '../lib/crawl-canonicals.js';

const UIStrings = {
  title: 'The canonicals of the crawled pages agree with the audited page',
  failureTitle: 'Other pages declare canonicals that conflict with the audited page',
  description:
    'Reads the canonicals of the pages the site crawl reached and fails when the audited page is a bad ' +
    'target for another page: it is an error, redirects, is noindex, declares a canonical of its own ' +
    '(a chain or a loop), or it is the shared canonical of pages with different content. The audited ' +
    "page's own canonical target is checked by indexability-conflicts and not repeated. Conflicts among " +
    'other crawled pages are listed, not judged. It reads server HTML, so a canonical added by ' +
    'JavaScript is not seen. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class CanonicalConflicts extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'canonical-conflicts',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-canonicals.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildCanonicalConflictsProduct(artifacts.SiteCrawl);
  }
}

export default CanonicalConflicts;
export {UIStrings};
