/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  default: MetaDescriptionIdenticalToTitle,
  classifyDuplication,
} = require('../../src/audits/meta-description-identical-to-title.js');

/**
 * This audit imports only `lighthouse/core/audits/audit.js`, not `rule-engine/registry.js`, so
 * (unlike the audits that resolve a ruleset) it has no `import.meta.url` at module scope and
 * loads directly inside Jest — no shell-out-to-real-node workaround needed here.
 * @param {{text: string, widthPx: number} | null} title
 * @param {{text: string, widthPx: number} | null} description
 */
function runAudit(title, description) {
  return MetaDescriptionIdenticalToTitle.audit({PixelWidth: {title, description}});
}

describe('classifyDuplication', () => {
  it('classifies an exact match (case/whitespace-insensitive) as identical', () => {
    expect(classifyDuplication('My Page Title', 'my   page title')).toBe('identical');
  });

  it('classifies a trailing-punctuation-only difference as identical', () => {
    expect(classifyDuplication('My Page Title', 'My Page Title.')).toBe('identical');
  });

  it('classifies a title-plus-site-suffix description as near-identical', () => {
    expect(classifyDuplication('My Page Title', 'My Page Title | My Site')).toBe('near-identical');
  });

  it('does not classify a substantive description that merely reuses title words', () => {
    expect(
      classifyDuplication(
        'Buy Running Shoes',
        'Buy running shoes online with free shipping and a 30-day returns policy.'
      )
    ).toBeNull();
  });

  it('returns null when either string is empty after normalizing', () => {
    expect(classifyDuplication('', 'A description')).toBeNull();
    expect(classifyDuplication('A title', '   ')).toBeNull();
  });
});

describe('meta-description-identical-to-title audit', () => {
  it('scores 1 when title and description are substantively different', () => {
    const result = runAudit(
      {text: 'Buy Running Shoes', widthPx: 100},
      {text: 'Free shipping on all running shoes, 30-day returns.', widthPx: 200}
    );
    expect(result.score).toBe(1);
  });

  it('scores 0 with an explanation when the description is identical to the title', () => {
    const result = runAudit(
      {text: 'My Page Title', widthPx: 100},
      {text: 'My Page Title', widthPx: 100}
    );
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('identical to the page title');
  });

  it('scores 0 with an explanation when the description is near-identical to the title', () => {
    const result = runAudit(
      {text: 'My Page Title', widthPx: 100},
      {text: 'My Page Title | My Site', widthPx: 150}
    );
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('nearly identical to the page title');
  });

  it('is notApplicable when title is absent', () => {
    const result = runAudit(null, {text: 'A description', widthPx: 100});
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  });

  it('is notApplicable when description is absent', () => {
    const result = runAudit({text: 'A title', widthPx: 100}, null);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  });

  it('is notApplicable when both are absent', () => {
    const result = runAudit(null, null);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  });
});
