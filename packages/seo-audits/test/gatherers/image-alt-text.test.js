/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: ImageAltText} = require('../../src/gatherers/image-alt-text.js');

describe('ImageAltText gatherer', () => {
  it('returns the evaluated artifact unchanged and evaluates in the isolated context', async () => {
    const resolution = {
      images: [
        {
          src: 'https://example.com/a.jpg',
          alt: null,
          hidden: false,
          decorative: false,
          width: 10,
          height: 10,
        },
      ],
    };
    const evaluate = jest.fn(() => Promise.resolve(resolution));
    const gatherer = new ImageAltText();
    // @ts-expect-error - partial pass context
    await expect(gatherer.getArtifact({driver: {executionContext: {evaluate}}})).resolves.toEqual(
      resolution
    );
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({useIsolation: true})
    );
  });
});
