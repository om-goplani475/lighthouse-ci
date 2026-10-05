/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDimensionsProduct} from '../lib/images.js';

const UIStrings = {
  title: 'Content images have width and height attributes',
  failureTitle: 'Some images have no width or height attribute',
  description:
    'Fails when a content img (at least 50 x 50 px) lacks a width or a height attribute, which makes the layout shift while it loads. Stricter than core unsized-images, which also accepts CSS sizes.',
};

class ImageDimensionsAttributes extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'image-dimensions-attributes',
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
    return buildDimensionsProduct(artifacts.ImageElements);
  }
}

export default ImageDimensionsAttributes;
export {UIStrings};
