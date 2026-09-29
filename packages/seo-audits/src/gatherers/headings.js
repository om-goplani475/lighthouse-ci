/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';

/* eslint-env browser */

/**
 * @typedef {{h1Texts: string[]}} HeadingsArtifact
 */

/* c8 ignore start */
function collectHeadings() {
  // Empty-text <h1> elements are filtered out here (not carried through as empty strings):
  // Lighthouse core's own `empty-heading` audit already flags those as an accessibility issue,
  // and an H1 with no real text doesn't meaningfully count as "having an H1" for this package's
  // presence/count check either way.
  return {
    h1Texts: Array.from(document.querySelectorAll('h1'))
      .map(el => (el.textContent || '').trim())
      .filter(Boolean),
  };
}
/* c8 ignore stop */

/**
 * Collects the trimmed text content of every non-empty <h1> element on the page. Rule-agnostic,
 * like every gatherer in this package except PixelWidth — no versioned data needed to just read
 * H1 text.
 */
class Headings extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<HeadingsArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    const driver = passContext.driver;

    return driver.executionContext.evaluate(collectHeadings, {
      args: [],
      useIsolation: true,
      deps: [],
    });
  }
}

export default Headings;
