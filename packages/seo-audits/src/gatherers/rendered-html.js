/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';

/* eslint-env browser */

/** @typedef {{html: string, truncated: boolean}} RenderedHtmlArtifact */

const MAX_HTML_CHARS = 2 * 1024 * 1024;

/* c8 ignore start */
function collectRenderedHtml() {
  const MAX = 2 * 1024 * 1024;
  const html = document.documentElement ? document.documentElement.outerHTML : '';
  return {html: html.slice(0, MAX), truncated: html.length > MAX};
}
/* c8 ignore stop */

/**
 * Collects the page's HTML as it is in the browser after load (the rendered DOM), to compare with the raw
 * HTML Lighthouse already keeps as `MainDocumentContent`. Rule-agnostic: the comparison is in
 * lib/rendering.js. Capped at 2 MiB of characters so a huge DOM cannot grow the artifact without bound.
 */
class RenderedHtml extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<RenderedHtmlArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    return passContext.driver.executionContext.evaluate(collectRenderedHtml, {
      args: [],
      useIsolation: true,
      deps: [],
    });
  }
}

export default RenderedHtml;
export {MAX_HTML_CHARS};
