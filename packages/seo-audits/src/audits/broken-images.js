/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {NetworkRecords} from 'lighthouse/core/computed/network-records.js';
import {buildFailedImagesProduct} from '../lib/images.js';

const UIStrings = {
  title: 'No image failed to load',
  failureTitle: 'Some images failed to load',
  description:
    'Fails when an image request of the page load answered 4xx or 5xx, or got no response (cancelled and blocked requests are ignored); a failing image served by another site (an ad or a widget) is only a note. Read from the page-load network log, no extra request.',
};

class BrokenImages extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'broken-images',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['DevtoolsLog', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/images.js`, unit-tested there.
   * @param {any} artifacts
   * @param {any} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const records = await NetworkRecords.request(artifacts.DevtoolsLog, context);
    return buildFailedImagesProduct(
      records,
      artifacts.URL && (artifacts.URL.finalDisplayedUrl || artifacts.URL.requestedUrl)
    );
  }
}

export default BrokenImages;
export {UIStrings};
