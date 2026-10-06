/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  headerValues,
  evaluateContentTypeOptions,
  evaluateReferrerPolicy,
  describeCsp,
  parseCsp,
  headerProduct,
  cspProduct,
} = require('../../src/lib/security-headers.js');

describe('headerValues', () => {
  it('reads a header case-insensitively, keeps every value in order, and survives odd input', () => {
    const headers = [
      {name: 'X-Content-Type-Options', value: 'nosniff'},
      {name: 'x-content-type-options', value: 'other'},
      {name: 'Server', value: 'x'},
    ];
    expect(headerValues(headers, 'x-content-type-options')).toEqual(['nosniff', 'other']);
    expect(headerValues(undefined, 'x')).toEqual([]);
    expect(headerValues([null, {name: undefined, value: 'x'}], 'x')).toEqual([]);
  });
});

describe('evaluateContentTypeOptions', () => {
  it('passes nosniff in any case, with spaces, or as the first of a list', () => {
    for (const v of ['nosniff', 'NoSniff', ' nosniff ', 'nosniff, nosniff', 'nosniff, other']) {
      expect(evaluateContentTypeOptions([v]).hasProblem).toBe(false);
    }
  });

  it('flags a missing header and any first value that is not nosniff', () => {
    const missing = evaluateContentTypeOptions([]);
    expect(missing.hasProblem).toBe(true);
    expect(missing.findings[0].finding).toMatch(/missing/);
    expect(evaluateContentTypeOptions(['sniff']).findings[0].finding).toMatch(/"sniff"/);
    // browsers read only the first value
    expect(evaluateContentTypeOptions(['other, nosniff']).hasProblem).toBe(true);
  });

  it('clips a huge hostile value', () => {
    const result = evaluateContentTypeOptions(['x'.repeat(5000)]);
    expect(result.value.length).toBeLessThan(400);
    expect(result.findings[0].finding.length).toBeLessThan(500);
  });
});

describe('evaluateReferrerPolicy', () => {
  it('does not fault a missing header, because browsers already default to a sound policy', () => {
    const r = evaluateReferrerPolicy([]);
    expect(r.hasProblem).toBe(false);
    expect(r.findings[0].severity).toBe('note');
  });

  it('passes the sound policies and judges a fallback list by its last recognised value', () => {
    for (const v of [
      'strict-origin-when-cross-origin',
      'no-referrer',
      'same-origin',
      'origin',
      'strict-origin',
    ]) {
      const r = evaluateReferrerPolicy([v]);
      expect(r.hasProblem).toBe(false);
      expect(r.findings).toEqual([]);
    }
    expect(evaluateReferrerPolicy(['unsafe-url, strict-origin']).hasProblem).toBe(false);
    expect(evaluateReferrerPolicy(['strict-origin, unsafe-url']).hasProblem).toBe(true);
    expect(evaluateReferrerPolicy(['no-referrer', 'unsafe-url']).hasProblem).toBe(true);
  });

  it('fails only unsafe-url, and notes the old default and unknown values', () => {
    expect(evaluateReferrerPolicy(['unsafe-url']).findings[0].finding).toMatch(/full address/);
    const old = evaluateReferrerPolicy(['no-referrer-when-downgrade']);
    expect(old.hasProblem).toBe(false);
    expect(old.findings[0].severity).toBe('note');
    const junk = evaluateReferrerPolicy(['whatever']);
    expect(junk.hasProblem).toBe(false);
    expect(junk.findings[0].finding).toMatch(/No recognised/);
  });
});

describe('describeCsp', () => {
  const row = (csp, check) => csp.rows.find(r => r.check === check).result;

  it('reports no policy, and a report-only policy as not enforcing', () => {
    expect(describeCsp([], []).present).toBe(false);
    expect(describeCsp([], []).rows[0].result).toBe('No policy is sent.');
    const reportOnly = describeCsp([], ["default-src 'self'"]);
    expect(reportOnly.present).toBe(false);
    expect(reportOnly.reportOnly).toBe(true);
    expect(reportOnly.rows[0].result).toMatch(/blocks nothing/);
  });

  it('reads script sources, falling back to default-src', () => {
    const strict = describeCsp(["default-src 'self'; frame-ancestors 'none'"], []);
    expect(row(strict, 'Script sources')).toBe('Inline scripts are not allowed.');
    expect(row(strict, 'frame-ancestors')).toMatch(/^Set/);
    const loose = describeCsp(["script-src 'self' 'unsafe-inline' 'unsafe-eval'"], []);
    expect(row(loose, 'Script sources')).toMatch(/unsafe-inline/);
    expect(row(loose, 'Eval')).toMatch(/unsafe-eval/);
    expect(row(loose, 'frame-ancestors')).toMatch(/^Not set/);
    const fallback = describeCsp(["default-src 'unsafe-inline'"], []);
    expect(row(fallback, 'Script sources')).toMatch(/unsafe-inline/);
  });

  it('says so when no directive restricts scripts', () => {
    expect(row(describeCsp(["img-src 'self'"], []), 'Script sources')).toMatch(/not restricted/);
  });

  it('treats several policies together and survives empty and hostile values', () => {
    const csp = describeCsp(["default-src 'self'", "script-src 'unsafe-inline'"], []);
    expect(row(csp, 'Content-Security-Policy')).toBe('Sent (2 policies).');
    expect(row(csp, 'Script sources')).toMatch(/unsafe-inline/);
    expect(() => describeCsp([';;;', '', 'x'.repeat(10000)], [])).not.toThrow();
  });

  it('keeps the first occurrence of a repeated directive, as browsers do', () => {
    const p = parseCsp("script-src 'self'; script-src 'unsafe-inline'");
    expect(p.get('script-src')).toEqual(["'self'"]);
  });
});

describe('products', () => {
  it('a header problem is a partial score, not a failure, with a table and an explanation', () => {
    const product = headerProduct(evaluateContentTypeOptions([]), 'X-Content-Type-Options');
    expect(product.score).toBe(0.5);
    expect(product.displayValue).toBe('Missing');
    expect(product.explanation).toMatch(/nosniff/);
    expect(product.details.items[0].value).toBe('(missing)');
  });

  it('a correct header scores 1 and shows its value', () => {
    const product = headerProduct(
      evaluateContentTypeOptions(['nosniff']),
      'X-Content-Type-Options'
    );
    expect(product.score).toBe(1);
    expect(product.explanation).toBeUndefined();
    expect(product.details.items[0]).toMatchObject({
      value: 'nosniff',
      finding: 'Present and correct.',
    });
  });

  it('a note alone does not lower the score', () => {
    expect(headerProduct(evaluateReferrerPolicy([]), 'Referrer-Policy').score).toBe(1);
  });

  it('the CSP report is informational and says what it found', () => {
    const product = cspProduct(describeCsp(["default-src 'self'"], []));
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('Policy sent');
    expect(cspProduct(describeCsp([], [])).displayValue).toBe('No policy');
    expect(cspProduct(describeCsp([], ['x'])).displayValue).toBe('Report-only');
  });
});
