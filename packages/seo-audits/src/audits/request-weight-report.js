/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {NetworkRecords} from 'lighthouse/core/computed/network-records.js';
import {buildRequestWeightProduct} from '../lib/page-weight.js';

const UIStrings = {
  title: 'Requests and bytes of the page load',
  description:
    'Informational: how many requests the page load made and how many bytes, by resource type and by host, with the ten largest. Many requests and large payloads cost users time and, on very large sites, crawl effort. Google documents no threshold, so this never fails. Read from the network log of the load; no extra request.',
};

class RequestWeightReport extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'request-weight-report',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['DevtoolsLog', 'URL'],
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
    return buildRequestWeightProduct(records, artifacts.URL.finalDisplayedUrl);
  }
}

export default RequestWeightReport;
export {UIStrings};
