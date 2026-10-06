/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Confirms the thumbnails named in the page's VideoObject markup answer: Google needs a crawlable thumbnail to show the video.
 * At most five thumbnails, one status request each (no body downloaded, no redirect followed, 5 s each), through the SSRF-
 * protected helpers: a thumbnail on the audited page's own site uses the same lookup as the page (so the private-network
 * opt-in applies), a thumbnail on another site (a CDN) is fetched with public addresses only. Only a 404, a 410 or a host that
 * does not exist is a defect; a refusal, a timeout or a 5xx is a note (bot protection or a hiccup), as elsewhere in this package.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {videoThumbnailProduct, THUMBNAIL_TIMEOUT_MS} from '../lib/video.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';
import {safeFetchStatus, statusWithLookup, publicOnlyLookup} from '../lib/safe-fetch.js';
import {siteOf} from '../lib/images.js';

const UIStrings = {
  title: 'Video thumbnails are reachable',
  failureTitle: 'A video thumbnail is gone',
  description:
    'Advice, not a failure (a partial score). Requests the thumbnailUrl of each VideoObject on the page (at most 5, status only, ' +
    'no redirect followed) and warns for a 404, a 410 or a host that does not exist: Google needs a crawlable thumbnail to show ' +
    'the video. A refusal (401, 403, 406, 429), a 5xx or a timeout is only a note, because bot protection and brief failures ' +
    'look the same. A thumbnail on another site is requested with public addresses only. Not applicable without a thumbnailUrl.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class VideoThumbnailReachable extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'video-thumbnail-reachable',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/video.js`, unit-tested there with a fake fetcher; the real requests are verified by
   * the live `lhci collect` run.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact, URL: {finalDisplayedUrl?: string, requestedUrl?: string}}} artifacts
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static audit(artifacts) {
    const pageUrl =
      (artifacts.URL && (artifacts.URL.finalDisplayedUrl || artifacts.URL.requestedUrl)) || '';
    return videoThumbnailProduct(
      entitiesFromArtifact(artifacts.StructuredDataJsonLd),
      pageUrl,
      (url, firstParty) =>
        firstParty
          ? safeFetchStatus(url, {timeoutMs: THUMBNAIL_TIMEOUT_MS})
          : statusWithLookup(url, publicOnlyLookup, {timeoutMs: THUMBNAIL_TIMEOUT_MS}),
      siteOf
    );
  }
}

export default VideoThumbnailReachable;
export {UIStrings};
