/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDeadEndProduct} from '../lib/crawl-link-audits.js';

const UIStrings = {
  title: 'The page links on to other pages',
  failureTitle: 'The page is a dead end with no links to other pages',
  description:
    'Fails when the audited page has no followable internal link to a different page, so a visitor or crawler that arrives has nowhere to go. A link to the page itself or marked nofollow does not count. Other crawled dead ends are listed, not judged. Links are read from the server HTML of the pages the site crawl reached, so a page built by ' +
    'JavaScript is not applicable. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class DeadEndPages extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'dead-end-pages',
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
    return buildDeadEndProduct(artifacts.SiteCrawl);
  }
}

export default DeadEndPages;
export {UIStrings};
