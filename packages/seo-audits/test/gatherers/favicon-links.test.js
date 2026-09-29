/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: FaviconLinks} = require('../../src/gatherers/favicon-links.js');

/**
 * Mocks `driver.executionContext.evaluate` rather than actually running it — exercises only the
 * gatherer's own control flow. The real DOM-querying behavior of `collectFaviconLinks` is
 * verified by the live `lhci collect` run instead (see docs/qa/favicon-and-manifest.md).
 * @param {unknown} evaluateResolution
 */
function runGatherer(evaluateResolution) {
  const passContext = {
    driver: {
      executionContext: {
        evaluate: () => Promise.resolve(evaluateResolution),
      },
    },
  };
  const gatherer = new FaviconLinks();
  return gatherer.getArtifact(passContext);
}

describe('FaviconLinks gatherer', () => {
  it('returns the evaluated artifact unchanged', async () => {
    const resolution = [
      {rel: 'icon', href: 'https://example.com/icon.png', sizes: null, type: null},
    ];
    await expect(runGatherer(resolution)).resolves.toEqual(resolution);
  });

  it('passes through an empty array unchanged', async () => {
    await expect(runGatherer([])).resolves.toEqual([]);
  });
});
