/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildThinContentProduct} from '../lib/crawl-thin.js';

const UIStrings = {
  title: 'Text content of the page',
  failureTitle: 'The page has thin content',
  description:
    'Informational (never fails a build): flags when the audited page has fewer than 200 words of visible text in its server HTML. The ' +
    'text-to-HTML ratio is shown for information and never fails. Other crawled pages under 200 words are ' +
    'listed, not judged. Words are counted from the HTML the site crawl received, so a page built by ' +
    'JavaScript can read as thin; when a browser clearly shows far more text, the audit is not ' +
    'applicable instead. See crawl-coverage for how much of the site was seen.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ThinContent extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'thin-content',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the judgement is in `lib/crawl-thin.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildThinContentProduct(artifacts.SiteCrawl);
  }
}

export default ThinContent;
export {UIStrings};
