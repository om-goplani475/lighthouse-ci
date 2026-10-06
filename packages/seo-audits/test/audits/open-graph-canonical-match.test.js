/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  default: OpenGraphCanonicalMatch,
} = require('../../src/audits/open-graph-canonical-match.js');

/**
 * @param {string | undefined} ogUrl
 * @param {string | undefined} canonicalHref
 */
function runAudit(ogUrl, canonicalHref) {
  return OpenGraphCanonicalMatch.audit({
    MetaElements: ogUrl ? [{property: 'og:url', content: ogUrl}] : [],
    LinkElements: canonicalHref ? [{rel: 'canonical', href: canonicalHref, source: 'head'}] : [],
  });
}

describe('open-graph-canonical-match audit', () => {
  it('scores 1 when og:url exactly matches the canonical URL', () => {
    const result = runAudit('https://example.com/page', 'https://example.com/page');
    expect(result.score).toBe(1);
  });

  it('scores 1 when the only difference is a trailing slash', () => {
    const result = runAudit('https://example.com/page/', 'https://example.com/page');
    expect(result.score).toBe(1);
  });

  it('notes, and does not fail, a difference in the query string only', () => {
    const result = runAudit('https://example.com/page?utm_source=x', 'https://example.com/page');
    expect(result.score).toBe(1);
    expect(result.displayValue).toContain('query string');
  });

  it('fails when og:url points at a different path than the canonical', () => {
    const result = runAudit('https://example.com/other-page', 'https://example.com/page');
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('does not match');
  });

  it('fails when og:url and the canonical differ only by scheme', () => {
    const result = runAudit('http://example.com/page', 'https://example.com/page');
    expect(result.score).toBe(0);
  });

  it('is notApplicable when og:url is absent', () => {
    const result = runAudit(undefined, 'https://example.com/page');
    expect(result.notApplicable).toBe(true);
  });

  it('is notApplicable when the canonical is absent', () => {
    const result = runAudit('https://example.com/page', undefined);
    expect(result.notApplicable).toBe(true);
  });

  it('is notApplicable, not a false failure, when og:url is unparseable', () => {
    const result = runAudit('not a url', 'https://example.com/page');
    expect(result.notApplicable).toBe(true);
  });

  it('ignores a body-injected canonical link, same boundary as canonical-https', () => {
    const result = OpenGraphCanonicalMatch.audit({
      MetaElements: [{property: 'og:url', content: 'https://example.com/page'}],
      LinkElements: [{rel: 'canonical', href: 'https://example.com/other', source: 'body'}],
    });
    expect(result.notApplicable).toBe(true);
  });
});
