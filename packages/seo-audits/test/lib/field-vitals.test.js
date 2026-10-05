/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildFieldVitalsProduct, rate, THRESHOLDS} = require('../../src/lib/field-vitals.js');

const m = (/** @type {number} */ p75, good = 0.7) => ({
  p75,
  good,
  needsImprovement: 0.2,
  poor: 0.1,
});
const art = (/** @type {any} */ metrics, over = {}) => ({
  state: 'ok',
  reason: null,
  source: 'url',
  target: 'https://example.com/a',
  formFactor: 'PHONE',
  collectionPeriod: {first: '2026-09-08', last: '2026-10-05'},
  metrics,
  ...over,
});
// @ts-expect-error - partial test artifacts
const run = a => buildFieldVitalsProduct(a);

describe('rate', () => {
  it('uses Google thresholds with the boundary values on the good side and over-poor as poor', () => {
    expect(rate('lcp', 2500)).toBe('good');
    expect(rate('lcp', 2501)).toBe('needs improvement');
    expect(rate('lcp', 4000)).toBe('needs improvement');
    expect(rate('lcp', 4001)).toBe('poor');
    expect(rate('inp', 200)).toBe('good');
    expect(rate('inp', 501)).toBe('poor');
    expect(rate('cls', 0.1)).toBe('good');
    expect(rate('cls', 0.25)).toBe('needs improvement');
    expect(rate('cls', 0.26)).toBe('poor');
    expect(THRESHOLDS.lcp.judged && THRESHOLDS.inp.judged && THRESHOLDS.cls.judged).toBe(true);
    expect(THRESHOLDS.fcp.judged || THRESHOLDS.ttfb.judged).toBe(false);
  });
});

describe('buildFieldVitalsProduct', () => {
  it('passes when all three vitals are good, with a readable summary', () => {
    const p = run(art({lcp: m(2300), inp: m(180), cls: m(0.04)}));
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('LCP 2.3 s, INP 180 ms, CLS 0.04 (URL, phone)');
    expect(p.details.items).toHaveLength(3);
    expect(p.details.items[0]).toMatchObject({
      metric: 'Largest Contentful Paint',
      result: 'good',
      good: '70%',
    });
  });

  it('fails only on a poor judged metric and names it', () => {
    const p = run(art({lcp: m(4500), inp: m(180), cls: m(0.04)}));
    expect(p.score).toBe(0);
    expect(p.explanation).toMatch(/Largest Contentful Paint 4\.5 s as poor/);
    expect(run(art({lcp: m(3000), inp: m(300), cls: m(0.2)})).score).toBe(1);
  });

  it('notes needs-improvement metrics without failing', () => {
    const p = run(art({lcp: m(3000), inp: m(180), cls: m(0.04)}));
    expect(p.score).toBe(1);
    expect(p.displayValue).toMatch(/needs improvement: Largest Contentful Paint/);
  });

  it('shows FCP and TTFB without judging them', () => {
    const p = run(art({lcp: m(2000), fcp: m(9000), ttfb: m(9000)}));
    expect(p.score).toBe(1);
    expect(p.details.items.map((/** @type {any} */ i) => i.metric)).toEqual([
      'Largest Contentful Paint',
      'First Contentful Paint (not judged)',
      'Time to First Byte (not judged)',
    ]);
  });

  it('judges what is there when INP is missing, and says when the data is from the origin or desktop', () => {
    const p = run(art({lcp: m(5000), cls: m(0.01)}, {source: 'origin', formFactor: 'DESKTOP'}));
    expect(p.score).toBe(0);
    expect(p.explanation).toMatch(
      /the whole site \(no data for this URL\), desktop visitors, 2026-09-08 to 2026-10-05/
    );
    expect(p.displayValue).toMatch(/\(site, desktop\)$/);
  });

  it('is not applicable without data, with the reason', () => {
    expect(run(null).notApplicable).toBe(true);
    expect(run({state: 'disabled', reason: 'Field data is off: set X'}).explanation).toBe(
      'Field data is off: set X'
    );
    expect(run({state: 'no-data', reason: null}).explanation).toMatch(/No field data/);
    expect(run(art({fcp: m(1000)})).notApplicable).toBe(true);
    expect(run(art({lcp: {p75: null}})).notApplicable).toBe(true);
    expect(run(art(null)).notApplicable).toBe(true);
  });
});
