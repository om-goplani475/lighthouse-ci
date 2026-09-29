/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: CanonicalHttps} = require('../../src/audits/canonical-https.js');

/**
 * @param {Array<{rel: string, href: string | null, source?: string}>} linkElements
 */
function runAudit(linkElements) {
  return CanonicalHttps.audit({LinkElements: linkElements});
}

describe('canonical-https audit', () => {
  it('scores 1 for an https canonical', () => {
    const result = runAudit([{rel: 'canonical', href: 'https://example.com/page', source: 'head'}]);
    expect(result.score).toBe(1);
    expect(result.notApplicable).toBeFalsy();
  });

  it('scores 0 with an explanation for an http canonical', () => {
    const result = runAudit([{rel: 'canonical', href: 'http://example.com/page', source: 'head'}]);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('http://example.com/page');
  });

  it("is notApplicable (score 1, matching core canonical.js's own convention) when there is no canonical link", () => {
    const result = runAudit([
      {rel: 'stylesheet', href: 'https://example.com/style.css', source: 'head'},
    ]);
    expect(result).toEqual({score: 1, notApplicable: true});
  });

  it('ignores a canonical link found in the body (not a real SEO canonical, same as core)', () => {
    const result = runAudit([{rel: 'canonical', href: 'http://example.com/page', source: 'body'}]);
    expect(result).toEqual({score: 1, notApplicable: true});
  });

  it("ignores a canonical link with no resolved href (invalid — core's canonical audit already flags this)", () => {
    const result = runAudit([{rel: 'canonical', href: null, source: 'head'}]);
    expect(result).toEqual({score: 1, notApplicable: true});
  });

  it('flags when any of multiple canonical links is non-https', () => {
    const result = runAudit([
      {rel: 'canonical', href: 'https://example.com/a', source: 'head'},
      {rel: 'canonical', href: 'http://example.com/b', source: 'head'},
    ]);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('http://example.com/b');
    expect(result.explanation).not.toContain('https://example.com/a');
  });
});
