/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: H1TitleRelevance} = require('../../src/audits/h1-title-relevance.js');

/**
 * @param {string[]} h1Texts
 * @param {{text: string, widthPx: number} | null} title
 */
function runAudit(h1Texts, title) {
  return H1TitleRelevance.audit({
    Headings: {h1Texts},
    PixelWidth: {title, description: null, titleElementCount: h1Texts.length ? 1 : 0},
  });
}

describe('h1-title-relevance audit', () => {
  it('scores null, no rows, when the H1 shares a significant word with the title', () => {
    const result = runAudit(['Buy Running Shoes'], {
      text: 'Running Shoes Online Store',
      widthPx: 200,
    });
    expect(result.score).toBeNull();
    expect(result.details).toBeUndefined();
  });

  it('flags an H1 with zero significant words in common with the title', () => {
    const result = runAudit(['Welcome to Our Store'], {
      text: 'Buy Running Shoes Online',
      widthPx: 200,
    });
    expect(result.score).toBeNull();
    expect(result.details.items).toEqual([expect.objectContaining({h1: 'Welcome to Our Store'})]);
  });

  it('does not flag when both texts only contain stopwords/short words (no real signal either way)', () => {
    const result = runAudit(['To The'], {text: 'For You', widthPx: 100});
    expect(result.details).toBeUndefined();
  });

  it('checks each H1 independently when there are multiple', () => {
    const result = runAudit(['Running Shoes', 'Unrelated Section'], {
      text: 'Buy Running Shoes Online',
      widthPx: 200,
    });
    expect(result.details.items).toEqual([expect.objectContaining({h1: 'Unrelated Section'})]);
  });

  it('is notApplicable when there is no title', () => {
    const result = runAudit(['A Heading'], null);
    expect(result.notApplicable).toBe(true);
  });

  it('is notApplicable when there is no H1', () => {
    const result = runAudit([], {text: 'A Title', widthPx: 100});
    expect(result.notApplicable).toBe(true);
  });

  it('is scoreDisplayMode informative', () => {
    expect(H1TitleRelevance.meta.scoreDisplayMode).toBe('informative');
  });
});
