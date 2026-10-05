/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildLazyAboveFoldProduct} from '../lib/images.js';

const UIStrings = {
  title: 'No visible image is lazy-loaded',
  failureTitle: 'Some images in the first screen are lazy-loaded',
  description:
    'Fails when an img element inside the first viewport has loading="lazy". Core lcp-lazy-loaded only catches the largest-paint image; this catches any image the visitor sees first.',
};

class ImageLazyAboveFold extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'image-lazy-above-fold',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['ImageElements', 'ViewportDimensions'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/images.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildLazyAboveFoldProduct(artifacts.ImageElements, artifacts.ViewportDimensions);
  }
}

export default ImageLazyAboveFold;
export {UIStrings};
