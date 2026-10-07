/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {templateReportProduct} from '../lib/templates.js';

const UIStrings = {
  title: 'Pages are grouped by template, with the problems they share',
  failureTitle: 'Pages are grouped by template, with the problems they share',
  description:
    "Informational (never fails a build). Groups the crawled pages by the shape of their address (`/blog/:slug`) and counts the page-level problems each group has: no title, no description, no h1, noindex, thin text, a shared title and more. A problem on most of a template's pages is one fix in one file, not many pages to edit. A heuristic on the pages the crawl reached, not a model of the site's routing.",
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class TemplateGroupsReport extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'template-groups-report',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/templates.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return templateReportProduct(artifacts.SiteCrawl);
  }
}

export default TemplateGroupsReport;
export {UIStrings};
