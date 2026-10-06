/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDimensionsProduct} from '../lib/images.js';

const UIStrings = {
  title: 'Content images reserve their space',
  failureTitle: 'Some images do not reserve their space',
  description:
    'Fails when a content img (at least 50 x 50 px) does not reserve its space (width and height, or one of them plus an aspect-ratio, by attribute or by CSS), which makes the layout shift while it loads. Uses the same rule as core unsized-images, so the two now agree.',
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
