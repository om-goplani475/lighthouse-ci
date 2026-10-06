/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {videoDiscoverabilityProduct} from '../lib/video.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Embedded videos have video markup',
  failureTitle: 'An embedded video has no video markup',
  description:
    'Advice, not a failure (a partial score). Warns when the rendered page embeds a video (a `<video>` with a source, or a ' +
    'YouTube, Vimeo, Dailymotion, Wistia, JW Player, Brightcove, Twitch, Loom, Vidyard or Streamable player) but has no ' +
    'VideoObject markup (JSON-LD or Microdata), so Google may not show it as a video result. A decorative background video ' +
    '(autoplay with muted or loop, and no controls) is not counted. Reads the already collected rendered HTML, no extra ' +
    'request. Not applicable when the page embeds no video. Our judgement, not a Google requirement.',
};

// @ts-expect-error - RenderedHtml and StructuredDataJsonLd aren't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class VideoDiscoverability extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'video-discoverability',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['RenderedHtml', 'StructuredDataJsonLd'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/video.js`, unit-tested there.
   * @param {{RenderedHtml: {html: string}, StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return videoDiscoverabilityProduct(
      artifacts.RenderedHtml,
      entitiesFromArtifact(artifacts.StructuredDataJsonLd)
    );
  }
}

export default VideoDiscoverability;
export {UIStrings};
