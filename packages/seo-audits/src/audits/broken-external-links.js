/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildBrokenExternalLinksProduct} from '../lib/crawl-external-links.js';

const UIStrings = {
  title: 'The links to other sites work',
  failureTitle: 'Links to other sites are broken',
  description:
    'Fails when an external link on the audited page points at a page that is gone (404 or 410) or at a host that does not exist or refuses connections. ' +
    "Up to 20 of the page's links are checked on each run (LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS, 0 switches it off), at most 2 per host, status only (no body is read), " +
    'with the crawler user-agent and a 15 s budget, and never at a private address. A server error or a timeout is listed but does not fail; a ' +
    '401, 403 or 429 is not judged (many sites block link checkers). Third-party robots.txt files are not fetched.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class BrokenExternalLinks extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'broken-external-links',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-external-links.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildBrokenExternalLinksProduct(artifacts.SiteCrawl);
  }
}

export default BrokenExternalLinks;
export {UIStrings};
