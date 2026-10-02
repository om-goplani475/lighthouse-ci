/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDuplicateContentProduct} from '../lib/crawl-duplicate-content.js';

const UIStrings = {
  title: 'No other crawled page has the same text as this page',
  failureTitle: 'Another crawled page has exactly the same text',
  description:
    'Fails when another crawled page has exactly the same visible text as the audited page (a hash of the ' +
    'normalised text), and neither declares a canonical to another URL. Pages under 50 words are not ' +
    'compared (thin-content covers them), duplicates that differ only by a trailing slash or query ' +
    'string are reported with a note, and other duplicate groups are listed, not judged. Text is read from ' +
    'server HTML: a script-built page is not applicable, since empty app shells all look alike. Only exact ' +
    'matches count, not near-duplicates. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class DuplicateContent extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'duplicate-content',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-duplicate-content.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildDuplicateContentProduct(artifacts.SiteCrawl);
  }
}

export default DuplicateContent;
export {UIStrings};
