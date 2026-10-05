/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';

/* eslint-env browser */

/**
 * @typedef {{
 *   src: string,
 *   alt: string | null,
 *   hidden: boolean,
 *   decorative: boolean,
 *   width: number,
 *   height: number,
 * }} ImageAltEntry
 * @typedef {{images: ImageAltEntry[]}} ImageAltTextArtifact
 */

/* c8 ignore start */
function collectImageAltText() {
  const MAX_IMAGES = 500;
  const MAX_TEXT = 300;
  return {
    images: Array.from(document.images)
      .slice(0, MAX_IMAGES)
      .map(img => {
        const rect = img.getBoundingClientRect();
        const role = (img.getAttribute('role') || '').toLowerCase();
        const alt = img.getAttribute('alt');
        return {
          src: String(img.currentSrc || img.src || '').slice(0, 1000),
          alt: alt === null ? null : alt.slice(0, MAX_TEXT),
          hidden: img.closest('[aria-hidden="true"]') !== null,
          decorative: role === 'presentation' || role === 'none',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
  };
}
/* c8 ignore stop */

/**
 * Collects, for every <img> on the page, its alt text (null when the attribute is absent), whether it is
 * hidden from assistive technology or marked decorative, and its rendered size. Lighthouse's own
 * ImageElements artifact carries no alt text. Rule-agnostic: the judging is in lib/images.js.
 */
class ImageAltText extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<ImageAltTextArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    return passContext.driver.executionContext.evaluate(collectImageAltText, {
      args: [],
      useIsolation: true,
      deps: [],
    });
  }
}

export default ImageAltText;
