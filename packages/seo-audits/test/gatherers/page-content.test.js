/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: PageContent} = require('../../src/gatherers/page-content.js');

describe('PageContent gatherer', () => {
  it('returns the evaluated artifact unchanged and evaluates in the isolated context', async () => {
    const resolution = {
      url: 'https://example.com/',
      lang: 'en',
      title: 't',
      h1: [],
      text: 'x',
      textTruncated: false,
      proseText: 'x',
      hiddenWords: 0,
      hiddenSamples: [],
      metaDates: [],
      times: [],
    };
    const evaluate = jest.fn(() => Promise.resolve(resolution));
    // @ts-expect-error - partial pass context
    await expect(
      new PageContent().getArtifact({driver: {executionContext: {evaluate}}})
    ).resolves.toEqual(resolution);
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({useIsolation: true})
    );
  });
});
