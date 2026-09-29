/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: DocumentH1Count} = require('../../src/audits/document-h1-count.js');

/**
 * @param {string[]} h1Texts
 */
function runAudit(h1Texts) {
  return DocumentH1Count.audit({Headings: {h1Texts}});
}

describe('document-h1-count audit', () => {
  it('scores 1 for exactly one H1', () => {
    const result = runAudit(['Page Heading']);
    expect(result.score).toBe(1);
  });

  it('scores 0 with an explanation for zero H1s', () => {
    const result = runAudit([]);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('no <h1> element');
  });

  it('scores 0 with an explanation for multiple H1s', () => {
    const result = runAudit(['First Heading', 'Second Heading']);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('2 <h1> elements');
  });
});
