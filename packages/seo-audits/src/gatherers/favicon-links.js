/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lighthouse core's own `LinkElements` artifact collects every <link> element (used by
 * canonical.js and the robots audits' shared helper), but omits the `sizes` and `type`
 * attributes — not needed by anything core checks, but needed here for the favicon-quality
 * multi-size check and to identify which manifest link to fetch. Narrowly scoped to only the
 * icon/manifest-relevant `rel` values, unlike core's broader gatherer.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';

/* eslint-env browser */

/**
 * @typedef {{rel: string, href: string | null, sizes: string | null, type: string | null}} FaviconLink
 */
/** @typedef {FaviconLink[]} FaviconLinksArtifact */

/* c8 ignore start */
function collectFaviconLinks() {
  // Fixed, hardcoded here (not passed via `args`) since it's a static set of values, same as
  // every other gatherer's hardcoded DOM selectors in this package (e.g. headings.js's 'h1').
  const relevantRels = new Set([
    'icon',
    'shortcut icon',
    'apple-touch-icon',
    'apple-touch-icon-precomposed',
    'manifest',
  ]);
  return Array.from(document.querySelectorAll('link'))
    .filter(el => relevantRels.has((el.getAttribute('rel') || '').toLowerCase()))
    .map(el => ({
      rel: (el.getAttribute('rel') || '').toLowerCase(),
      href: el.href || null,
      sizes: el.getAttribute('sizes'),
      type: el.getAttribute('type'),
    }));
}
/* c8 ignore stop */

/**
 * Collects <link> elements relevant to favicons/manifest icons: `icon`, `shortcut icon`,
 * `apple-touch-icon`(-precomposed), and `manifest`, each with `href` (browser-resolved absolute
 * URL, same as core's LinkElements), `sizes`, and `type`.
 */
class FaviconLinks extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<FaviconLinksArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    const driver = passContext.driver;

    return driver.executionContext.evaluate(collectFaviconLinks, {
      args: [],
      useIsolation: true,
      deps: [],
    });
  }
}

export default FaviconLinks;
