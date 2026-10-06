/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {videoValuesProduct} from '../lib/video.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Video markup values are well formed',
  failureTitle: 'Video markup values need attention',
  description:
    "Advice, not a failure (a partial score). For each VideoObject in the page's JSON-LD, applies Google's video guidance: uploadDate and expires in ISO 8601 (a missing timezone is a note), duration as an ISO 8601 duration such as PT1M30S, and unique name and description text for each video on the page. Relative addresses, no contentUrl or embedUrl, and no description are notes. Missing required properties (name, thumbnailUrl, uploadDate) are reported by structured-data-schema-properties, not here. A page with no VideoObject is not applicable.",
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class VideoStructuredDataValues extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'video-structured-data-values',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/video.js`, unit-tested there.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return videoValuesProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd));
  }
}

export default VideoStructuredDataValues;
export {UIStrings};
