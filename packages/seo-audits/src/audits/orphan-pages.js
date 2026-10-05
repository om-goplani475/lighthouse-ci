/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildOrphanProduct} from '../lib/crawl-link-audits.js';

const UIStrings = {
  title: 'Other crawled pages link to this page',
  failureTitle: 'No crawled page links to this page',
  description:
    'Fails when no crawled page links to the audited page. Only judged when the crawl saw the whole site (no page cap, depth bound or time budget cut it, nothing blocked or unreadable), otherwise not applicable, because a link from a page not crawled would be missed. The homepage is not judged. Other orphans are listed, not judged. Links are read from the server HTML of the pages the site crawl reached, so a page built by ' +
    'JavaScript is not applicable. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class OrphanPages extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'orphan-pages',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-link-audits.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildOrphanProduct(artifacts.SiteCrawl);
  }
}

export default OrphanPages;
export {UIStrings};
