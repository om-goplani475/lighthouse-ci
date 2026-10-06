/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {summarizeRun} = require('../../src/summary/run-summary.js');
const {compareRuns, compareAll} = require('../../src/summary/compare.js');
const {RECOMMENDED, audit, lhr} = require('./fixtures.js');

const CATEGORIES = [{name: 'All', audits: Object.keys(RECOMMENDED)}];
const run = (/** @type {any} */ audits, /** @type {any} */ opts) =>
  summarizeRun(lhr(audits, opts), RECOMMENDED, CATEGORIES);

describe('compareRuns', () => {
  const before = run({
    'canonical-https': audit(0),
    'document-title-quality': audit(0.5),
    'sitemap-valid': audit(0),
    'duplicate-titles': audit(1),
  });
  const after = run({
    'canonical-https': audit(1),
    'document-title-quality': audit(0),
    'sitemap-valid': audit(0),
    'duplicate-titles': audit(0),
  });
  const c = compareRuns(before, after);

  it('finds new, fixed and still-failing issues', () => {
    expect(c.newIssues.map(r => r.id)).toEqual(['duplicate-titles']);
    expect(c.fixed.map(r => r.id)).toEqual(['canonical-https']);
    expect(c.stillFailing.map(r => r.id).sort()).toEqual([
      'document-title-quality',
      'sitemap-valid',
    ]);
  });

  it('tells worse from better among those that are still failing', () => {
    expect(c.worse.map(w => [w.audit.id, w.before])).toEqual([['document-title-quality', 0.5]]);
    const improved = compareRuns(
      run({'document-title-quality': audit(0)}),
      run({'document-title-quality': audit(0.5)})
    );
    expect(improved.better).toHaveLength(1);
  });

  it('reports the score change overall and per category', () => {
    expect(c.overallDelta).toBe(c.overallAfter - c.overallBefore);
    expect(c.categories[0]).toMatchObject({name: 'All'});
    expect(c.categories[0].delta).toBe(c.overallDelta);
  });

  it('treats a page that was not applicable before as new when it now fails', () => {
    const n = compareRuns(
      run({'canonical-https': audit(null)}),
      run({'canonical-https': audit(0)})
    );
    expect(n.newIssues.map(r => r.id)).toEqual(['canonical-https']);
    expect(n.overallDelta).toBeNull();
  });

  it('does not call an audit fixed when it merely went not applicable', () => {
    const f = compareRuns(
      run({'canonical-https': audit(0)}),
      run({'canonical-https': audit(null)})
    );
    expect(f.fixed.map(r => r.id)).toEqual(['canonical-https']);
  });
});

describe('compareAll', () => {
  it('pairs the pages of two reports, ignoring a trailing slash, and names the unpaired ones', () => {
    const before = [
      run({'canonical-https': audit(0)}, {url: 'https://a.test/x/'}),
      run({}, {url: 'https://gone.test/'}),
    ];
    const after = [
      run({'canonical-https': audit(1)}, {url: 'https://a.test/x'}),
      run({}, {url: 'https://new.test/'}),
    ];
    const {comparisons, onlyInBefore, onlyInAfter} = compareAll(before, after);
    expect([...comparisons.keys()]).toEqual(['https://a.test/x']);
    expect(comparisons.get('https://a.test/x').fixed).toHaveLength(1);
    expect(onlyInBefore).toEqual(['https://gone.test/']);
    expect(onlyInAfter).toEqual(['https://new.test/']);
  });
});
