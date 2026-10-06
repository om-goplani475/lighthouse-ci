/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {NetworkRecords} from 'lighthouse/core/computed/network-records.js';
import {buildRenderBlockingProduct} from '../lib/page-weight.js';

const UIStrings = {
  title: 'Render-blocking resources in the head',
  description:
    'Informational: lists the external scripts without async or defer and the stylesheets in the page head, which stop the browser from painting until they are fetched, with their sizes and where they are served from. Heavy blocking resources delay the first paint for visitors and slow the rendering step of search engines that render the page; this is about page speed, not about whether the page can be crawled or indexed. Google documents no threshold, so this never fails. Read from the HTML (an approximation: the preload scanner is not modelled).',
};

class RenderBlockingReport extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'render-blocking-report',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['MainDocumentContent', 'DevtoolsLog', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/page-weight.js`, unit-tested there.
   * @param {any} artifacts
   * @param {any} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const records = await NetworkRecords.request(artifacts.DevtoolsLog, context);
    return buildRenderBlockingProduct(
      artifacts.MainDocumentContent,
      records,
      artifacts.URL.finalDisplayedUrl
    );
  }
}

export default RenderBlockingReport;
export {UIStrings};
