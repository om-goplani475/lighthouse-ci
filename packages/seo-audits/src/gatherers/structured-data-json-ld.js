/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {pageFunctions} from 'lighthouse/core/lib/page-functions.js';

/* globals getElementsInDocument getNodeDetails */

/* c8 ignore start */
function collectStructuredDataJsonLd() {
  const functions = /** @type {typeof pageFunctions} */ ({
    // @ts-expect-error - getElementsInDocument put into scope via stringification
    getElementsInDocument,
    // @ts-expect-error - getNodeDetails put into scope via stringification
    getNodeDetails,
  });

  const scripts = functions.getElementsInDocument('script[type="application/ld+json"]');
  return scripts.map(script => ({
    content: script.textContent || '',
    node: functions.getNodeDetails(script),
  }));
}
/* c8 ignore stop */

/**
 * Collects the raw text content of every <script type="application/ld+json"> block on
 * the page. No parsing/validation here — see the structured-data-json-ld audit for that.
 * Modeled directly on the core MetaElements gatherer.
 */
class StructuredDataJsonLd extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<import('../types.js').StructuredDataJsonLdArtifact>}
   */
  // @ts-expect-error - BaseGatherer#getArtifact's return type is constrained to
  // Lighthouse's own closed `GathererArtifacts` union, which third-party gatherers
  // (like this one, from an out-of-tree fork package) are never part of. This is a
  // known boundary for out-of-tree Lighthouse gatherers, not a bug here; augmenting
  // Lighthouse's own ambient types from this package would mean patching upstream's
  // types from a consumer, which Option B (depend on upstream as a library, never
  // edit/augment its internals) deliberately avoids.
  getArtifact(passContext) {
    const driver = passContext.driver;

    return driver.executionContext.evaluate(collectStructuredDataJsonLd, {
      args: [],
      useIsolation: true,
      deps: [pageFunctions.getElementsInDocument, pageFunctions.getNodeDetails],
    });
  }
}

export default StructuredDataJsonLd;
