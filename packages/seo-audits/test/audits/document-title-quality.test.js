/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: DocumentTitleQuality} = require('../../src/audits/document-title-quality.js');

/**
 * This audit, like meta-description-identical-to-title, imports only
 * `lighthouse/core/audits/audit.js` — no `import.meta.url` at module scope, so it loads directly
 * inside Jest, no shell-out workaround needed.
 * @param {{text: string, widthPx: number} | null} title
 * @param {number} titleElementCount
 */
function runAudit(title, titleElementCount) {
  return DocumentTitleQuality.audit({
    PixelWidth: {title, description: null, titleElementCount},
  });
}

describe('document-title-quality audit', () => {
  it('scores 1 for a normal, substantive title with exactly one <title> element', () => {
    const result = runAudit({text: 'Buy Running Shoes Online', widthPx: 200}, 1);
    expect(result.score).toBe(1);
  });

  it('flags a generic/placeholder title', () => {
    const result = runAudit({text: 'Untitled Document', widthPx: 100}, 1);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      expect.objectContaining({issue: 'Generic/placeholder title'}),
    ]);
  });

  it('matches the placeholder list case- and whitespace-insensitively', () => {
    const result = runAudit({text: '  UNTITLED   DOCUMENT  ', widthPx: 100}, 1);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      expect.objectContaining({issue: 'Generic/placeholder title'}),
    ]);
  });

  it('flags a title under the minimum meaningful length', () => {
    const result = runAudit({text: 'Shoes', widthPx: 50}, 1);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([expect.objectContaining({issue: 'Title too short'})]);
  });

  it('flags multiple <title> elements regardless of what the (first) title text says', () => {
    const result = runAudit({text: 'Buy Running Shoes Online', widthPx: 200}, 2);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      expect.objectContaining({issue: 'Multiple <title> elements'}),
    ]);
    expect(result.details.items[0].detail).toContain('Found 2 <title> elements');
  });

  it('can report multiple distinct issues at once', () => {
    // "Untitled Document" is generic but not too-short (18 chars), isolating exactly the two
    // issues this test means to check — a title that were also under 10 chars would legitimately
    // add a third "Title too short" row too, which is correct behavior, not tested here.
    const result = runAudit({text: 'Untitled Document', widthPx: 100}, 2);
    const issues = result.details.items.map(row => row.issue).sort();
    expect(issues).toEqual(['Generic/placeholder title', 'Multiple <title> elements']);
  });

  it('is notApplicable when title is absent and there are zero or one <title> elements', () => {
    expect(runAudit(null, 0)).toEqual({score: null, notApplicable: true});
    expect(runAudit(null, 1)).toEqual({score: null, notApplicable: true});
  });

  it('is NOT notApplicable when title is absent but there are multiple <title> elements', () => {
    const result = runAudit(null, 3);
    expect(result.notApplicable).toBeFalsy();
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      expect.objectContaining({issue: 'Multiple <title> elements'}),
    ]);
  });
});
