/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildFilenameProduct} from '../lib/images.js';

const UIStrings = {
  title: 'Image file names are descriptive',
  failureTitle: 'Some images have non-descriptive file names',
  description:
    'Fails when a content image (at least 50 x 50 px, including CSS background images) has a file name that is a camera or tool default (IMG_1234, DSC0001, Screenshot 12), a number only, a hash or ID, or a generic word such as image or banner.',
};

class ImageFilenameQuality extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'image-filename-quality',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['ImageElements'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/images.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildFilenameProduct(artifacts.ImageElements);
  }
}

export default ImageFilenameQuality;
export {UIStrings};
