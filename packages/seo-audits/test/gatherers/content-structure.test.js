/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: ContentStructure} = require('../../src/gatherers/content-structure.js');

describe('ContentStructure gatherer', () => {
  it('returns the evaluated artifact unchanged and evaluates in the isolated context', async () => {
    const resolution = {
      headings: [],
      paragraphs: 0,
      lists: 0,
      tables: 0,
      definitionLists: 0,
      landmarks: {main: 1},
      questions: [],
    };
    const evaluate = jest.fn(() => Promise.resolve(resolution));
    // @ts-expect-error - partial pass context
    await expect(
      new ContentStructure().getArtifact({driver: {executionContext: {evaluate}}})
    ).resolves.toEqual(resolution);
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({useIsolation: true})
    );
  });
});
