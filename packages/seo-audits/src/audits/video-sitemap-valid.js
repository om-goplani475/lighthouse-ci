/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {videoSitemapProduct} from '../lib/video.js';

const UIStrings = {
  title: 'The video sitemap is valid',
  failureTitle: 'The video sitemap has invalid entries',
  description:
    "Fails when a video entry of a video sitemap (video:video) is missing a tag Google requires (video:thumbnail_loc, video:title, video:description, and video:content_loc or video:player_loc), has a description over 2,048 characters, a duration outside 1 to 28,800 seconds, a rating outside 0.0 to 5.0, more than 32 tags, a date that is not a W3C date, an address that is not absolute, or a video address equal to the page's own. Not applicable when no video entries were found among the sitemaps read, and says so when a sitemap file could not be read.",
};

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class VideoSitemapValid extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'video-sitemap-valid',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SitemapDocuments'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/video.js`, unit-tested there.
   * @param {{SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return videoSitemapProduct(artifacts.SitemapDocuments);
  }
}

export default VideoSitemapValid;
export {UIStrings};
