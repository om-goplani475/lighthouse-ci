/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for robots-directives-report's and robots-directives-conflict's decision logic
 * (`buildReportResult`/`buildConflictResult`), which both audits delegate to after resolving
 * their sources. Loads directly, no shell-out needed — see robots-directives.js's module doc.
 */

/* eslint-env jest */

const {buildReportResult, buildConflictResult} = require('../../src/lib/robots-directives.js');

describe('buildReportResult', () => {
  it('is notApplicable when neither source has any directive', () => {
    const result = buildReportResult({metaContent: undefined, headerValue: undefined});
    expect(result).toEqual({score: null, notApplicable: true});
  });

  it('reports meta-only directives, tagged with their source', () => {
    const result = buildReportResult({metaContent: 'noindex, nofollow', headerValue: undefined});
    expect(result.score).toBeNull();
    expect(result.details.items).toEqual([
      expect.objectContaining({source: 'meta robots', raw: 'noindex'}),
      expect.objectContaining({source: 'meta robots', raw: 'nofollow'}),
    ]);
  });

  it('reports both sources together when both are present', () => {
    const result = buildReportResult({metaContent: 'noindex', headerValue: 'nofollow'});
    expect(result.details.items.map(i => i.source)).toEqual(['meta robots', 'X-Robots-Tag header']);
  });

  it('flags an unrecognized token with a fallback explanation instead of dropping it', () => {
    const result = buildReportResult({metaContent: 'no-index', headerValue: undefined});
    expect(result.details.items[0].explanation).toContain('likely a typo');
  });
});

describe('buildConflictResult', () => {
  it('is notApplicable when only one source has directives', () => {
    expect(buildConflictResult({metaContent: 'noindex', headerValue: undefined})).toEqual({
      score: null,
      notApplicable: true,
    });
    expect(buildConflictResult({metaContent: undefined, headerValue: 'noindex'})).toEqual({
      score: null,
      notApplicable: true,
    });
  });

  it('scores 1 when both sources agree on indexability (both block)', () => {
    const result = buildConflictResult({metaContent: 'noindex', headerValue: 'noindex, nofollow'});
    expect(result.score).toBe(1);
  });

  it('scores 1 when both sources agree on indexability (neither blocks)', () => {
    const result = buildConflictResult({metaContent: 'nofollow', headerValue: 'noarchive'});
    expect(result.score).toBe(1);
  });

  it('scores 0 with an explanation when meta blocks but the header does not', () => {
    const result = buildConflictResult({metaContent: 'noindex', headerValue: 'index, follow'});
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('meta robots tag blocks indexing');
    expect(result.explanation).toContain('X-Robots-Tag header does not block');
  });

  it('scores 0 with an explanation when the header blocks but meta does not', () => {
    const result = buildConflictResult({metaContent: 'index, follow', headerValue: 'noindex'});
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('meta robots tag does not block');
    expect(result.explanation).toContain('X-Robots-Tag header blocks indexing');
  });
});
