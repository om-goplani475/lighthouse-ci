/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildAltQualityProduct} from '../lib/images.js';

const UIStrings = {
  title: 'Image alt text is meaningful',
  failureTitle: 'Some images have poor alt text',
  description:
    'Fails when a content image (at least 50 x 50 px, not hidden or decorative) has alt text that is a file name, a placeholder word such as image or photo, longer than 125 characters, or the same text on 3 or more different images. An empty alt (alt="") is a valid decorative choice and passes; a missing alt attribute is reported by Lighthouse core image-alt.',
};

class ImageAltQuality extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'image-alt-quality',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['ImageAltText'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/images.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildAltQualityProduct(artifacts.ImageAltText);
  }
}

export default ImageAltQuality;
export {UIStrings};
