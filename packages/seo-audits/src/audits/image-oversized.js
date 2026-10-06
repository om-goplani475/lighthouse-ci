/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildOversizedProduct} from '../lib/images.js';

const UIStrings = {
  title: 'Images are not much larger than they are shown',
  failureTitle: 'Some images are far larger than they are shown',
  description:
    'Fails when a raster content img is more than 3x wider than it is displayed and at least 100 px wider. A simpler rule than core image-size-responsive, which also depends on the device pixel ratio. SVG is not judged, and an image served by another site is only a note.',
};

class ImageOversized extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'image-oversized',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['ImageElements', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/images.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildOversizedProduct(
      artifacts.ImageElements,
      artifacts.URL && (artifacts.URL.finalDisplayedUrl || artifacts.URL.requestedUrl)
    );
  }
}

export default ImageOversized;
export {UIStrings};
