/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {summarizeRun, gradeOf, statusOf, reachOf} = require('../../src/summary/run-summary.js');
const {RECOMMENDED, audit, lhr} = require('./fixtures.js');

const CATEGORIES = [
  {name: 'Metadata', audits: ['canonical-https', 'document-title-quality']},
  {name: 'Duplicates', audits: ['sitemap-valid', 'duplicate-titles']},
  {name: 'Empty', audits: ['nothing-here']},
];

describe('statusOf and gradeOf', () => {
  it('maps scores and display modes to a status', () => {
    expect(statusOf(audit(1))).toBe('pass');
    expect(statusOf(audit(0.5))).toBe('warn');
    expect(statusOf(audit(0))).toBe('fail');
    expect(statusOf(audit(null))).toBe('na');
    expect(statusOf(audit(0, {scoreDisplayMode: 'informative'}))).toBe('na');
    expect(statusOf(audit(null, {scoreDisplayMode: 'error'}))).toBe('error');
    expect(statusOf(undefined)).toBe('na');
  });

  it('grades with A at 90 and F under 60, and has no grade without a score', () => {
    expect([100, 90, 89.9, 80, 70, 60, 59.9].map(gradeOf)).toEqual([
      'A',
      'A',
      'B',
      'B',
      'C',
      'D',
      'F',
    ]);
    expect(gradeOf(null)).toBe('-');
  });
});

describe('reachOf', () => {
  it('uses the numeric value, else the table rows without the "more not shown" row, else 1', () => {
    expect(reachOf({numericValue: 7.4})).toBe(7);
    expect(reachOf({details: {items: [{a: 1}, {a: 2}, {a: '3 more not shown'}]}})).toBe(2);
    expect(reachOf({})).toBe(1);
    expect(reachOf({numericValue: 0})).toBe(1);
  });
});

describe('summarizeRun scoring', () => {
  it('scores 100 and grade A when everything passes', () => {
    const run = summarizeRun(
      lhr({
        'canonical-https': audit(1),
        'document-title-quality': audit(1),
        'sitemap-valid': audit(1),
        'duplicate-titles': audit(1),
      }),
      RECOMMENDED,
      CATEGORIES
    );
    expect(run.overall).toMatchObject({score: 100, grade: 'A', applicable: 4, failures: 0});
    expect(run.issues).toEqual([]);
  });

  it('weighs an error-tier failure 3 times a warn-tier one', () => {
    const run = summarizeRun(
      lhr({'canonical-https': audit(0), 'document-title-quality': audit(1)}),
      RECOMMENDED,
      CATEGORIES
    );
    // earned 0 + 1 of 3 + 1 = 25%
    expect(run.categories[0]).toMatchObject({name: 'Metadata', score: 25, failures: 1, passed: 1});
    const warnFails = summarizeRun(
      lhr({'canonical-https': audit(1), 'document-title-quality': audit(0)}),
      RECOMMENDED,
      CATEGORIES
    );
    expect(warnFails.categories[0].score).toBe(75);
  });

  it('counts a partial score (0.5) as half and as a partial, not a failure', () => {
    const run = summarizeRun(lhr({'document-title-quality': audit(0.5)}), RECOMMENDED, CATEGORIES);
    expect(run.categories[0]).toMatchObject({score: 50, warnings: 1, failures: 0});
  });

  it('leaves out not-applicable audits, gives an empty category no score, and keeps the overall to what applied', () => {
    const run = summarizeRun(
      lhr({'canonical-https': audit(1), 'sitemap-valid': audit(null)}),
      RECOMMENDED,
      CATEGORIES
    );
    expect(run.categories[1]).toMatchObject({
      name: 'Duplicates',
      score: null,
      grade: '-',
      applicable: 0,
    });
    expect(run.categories[2].score).toBeNull();
    expect(run.overall).toMatchObject({score: 100, applicable: 1});
  });

  it('ignores an audit the preset does not list (informational) and one missing from the report', () => {
    const run = summarizeRun(
      lhr({'canonical-https': audit(1), 'thin-content': audit(0)}),
      RECOMMENDED,
      CATEGORIES
    );
    expect(run.auditsFound).toBe(1);
    expect(run.issues).toEqual([]);
  });

  it('counts an audit that errored and does not score it', () => {
    const run = summarizeRun(
      lhr({'canonical-https': audit(null, {scoreDisplayMode: 'error', errorMessage: 'boom'})}),
      RECOMMENDED,
      CATEGORIES
    );
    expect(run.auditErrors).toBe(1);
    expect(run.overall.applicable).toBe(0);
  });

  it('survives a malformed result', () => {
    expect(summarizeRun({}, RECOMMENDED, CATEGORIES).overall.score).toBeNull();
    // @ts-expect-error - deliberately wrong input
    expect(summarizeRun(null, RECOMMENDED, CATEGORIES).issues).toEqual([]);
  });
});

describe('summarizeRun issues', () => {
  const run = summarizeRun(
    lhr({
      'canonical-https': audit(0, {numericValue: 2}),
      'sitemap-valid': audit(0, {numericValue: 9}),
      'document-title-quality': audit(0, {numericValue: 50}),
      'duplicate-titles': audit(0.5, {numericValue: 3}),
    }),
    RECOMMENDED,
    CATEGORIES
  );

  it('ranks error tier before warn tier, then by reach, then by id', () => {
    expect(run.issues.map(i => i.id)).toEqual([
      'sitemap-valid',
      'canonical-https',
      'document-title-quality',
      'duplicate-titles',
    ]);
  });

  it('falls back to the first table row when an audit has no display value or explanation', () => {
    const r = summarizeRun(
      lhr({
        'canonical-https': audit(0, {
          displayValue: '',
          details: {
            items: [{property: 'og:title', message: 'Missing required "og:title" meta tag.'}],
          },
        }),
      }),
      RECOMMENDED,
      CATEGORIES
    );
    expect(r.issues[0].displayValue).toBe('Missing required "og:title" meta tag.');
  });

  it('carries the category, tier and the audit own text, clipped', () => {
    const first = run.issues[0];
    expect(first).toMatchObject({category: 'Duplicates', tier: 'error', reach: 9});
    expect(first.description).toMatch(/^About this audit/);
    const long = summarizeRun(
      lhr({'canonical-https': audit(0, {explanation: 'x'.repeat(2000)})}),
      RECOMMENDED,
      CATEGORIES
    );
    expect(long.issues[0].explanation.length).toBeLessThanOrEqual(403);
  });
});
