/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {NetworkRecords} from 'lighthouse/core/computed/network-records.js';
import {buildLegacyFormatProduct} from '../lib/images.js';

const UIStrings = {
  title: 'Large images use modern formats',
  failureTitle: 'Some large images use JPEG, PNG or GIF',
  description:
    'Fails when a loaded image is a JPEG, PNG or GIF over 10 KiB. WebP, AVIF and SVG pass. Read from the page-load network log, no extra request; stricter than core modern-image-formats, which only estimates savings.',
};

class ImageLegacyFormats extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'image-legacy-formats',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['DevtoolsLog'],
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
    return buildLegacyFormatProduct(records);
  }
}

export default ImageLegacyFormats;
export {UIStrings};
