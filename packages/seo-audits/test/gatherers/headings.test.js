/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: Headings} = require('../../src/gatherers/headings.js');

/**
 * Unlike pixel-width.js, this gatherer imports no rule-engine module — no `import.meta.url` at
 * module scope, so (like meta-description-identical-to-title.js) it loads directly inside Jest.
 * This mocks `driver.executionContext.evaluate` rather than actually running it — the collector
 * function itself (`collectHeadings`, DOM querying) is only exercised by the live `lhci collect`
 * verification, not by this mocked unit test.
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
  const gatherer = new Headings();
  return gatherer.getArtifact(passContext);
}

describe('Headings gatherer', () => {
  it('returns the evaluated artifact unchanged', async () => {
    const resolution = {h1Texts: ['Page Heading']};
    await expect(runGatherer(resolution)).resolves.toEqual(resolution);
  });

  it('passes through an empty array unchanged', async () => {
    const resolution = {h1Texts: []};
    await expect(runGatherer(resolution)).resolves.toEqual(resolution);
  });

  it('passes through multiple H1 texts unchanged', async () => {
    const resolution = {h1Texts: ['First Heading', 'Second Heading']};
    await expect(runGatherer(resolution)).resolves.toEqual(resolution);
  });
});
