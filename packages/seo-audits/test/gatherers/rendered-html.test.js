/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: RenderedHtml} = require('../../src/gatherers/rendered-html.js');

describe('RenderedHtml gatherer', () => {
  it('returns the evaluated artifact unchanged and evaluates in the isolated context', async () => {
    const resolution = {html: '<html></html>', truncated: false};
    const evaluate = jest.fn(() => Promise.resolve(resolution));
    // @ts-expect-error - partial pass context
    await expect(
      new RenderedHtml().getArtifact({driver: {executionContext: {evaluate}}})
    ).resolves.toEqual(resolution);
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({useIsolation: true})
    );
  });
});
