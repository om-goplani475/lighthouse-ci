/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildHistory,
  historyToCsv,
  compareStored,
  csvCell,
  MAX_POINTS,
} = require('../../src/service/run-history.js');
const {serializeRun} = require('../../src/service/run-result.js');
const {summarizeRun} = require('../../src/summary/run-summary.js');
const {RECOMMENDED, audit, lhr} = require('../summary/fixtures.js');

/** @param {Record<string, any>} over */
const stored = (id, url, at, score, over = {}) => ({
  id,
  url,
  branch: 'main',
  sha: 'a'.repeat(40),
  trigger: 'webhook',
  createdAt: at,
  summary: {
    overall: {score, grade: score >= 90 ? 'A' : 'F', failures: 2, warnings: 1},
    categories: [
      {name: 'Metadata', score},
      {name: 'Duplicates', score: null},
    ],
  },
  ...over,
});

describe('buildHistory', () => {
  const runs = [
    stored('3', 'https://a.test/x/', '2026-10-03T10:00:00Z', 90),
    stored('1', 'https://a.test/x', '2026-10-01T10:00:00Z', 70),
    stored('2', 'https://a.test/y', '2026-10-02T10:00:00Z', 80),
  ];

  it('orders oldest first and matches a page by path, ignoring a trailing slash and the host', () => {
    const {points, pages} = buildHistory(runs, {path: '/x'});
    expect(points.map(p => p.runId)).toEqual(['1', '3']);
    expect(points[0]).toMatchObject({score: 70, grade: 'F', failures: 2, warnings: 1, path: '/x'});
    expect(pages).toEqual([
      {path: '/x', runs: 2},
      {path: '/y', runs: 1},
    ]);
    expect(buildHistory(runs).points).toHaveLength(3);
  });

  it('filters by branch and keeps only the newest points when limited', () => {
    const mixed = [
      ...runs,
      stored('4', 'https://a.test/x', '2026-10-04T10:00:00Z', 95, {branch: 'f'}),
    ];
    expect(buildHistory(mixed, {branch: 'f'}).points.map(p => p.runId)).toEqual(['4']);
    expect(buildHistory(mixed, {path: '/x', limit: 2}).points.map(p => p.runId)).toEqual([
      '3',
      '4',
    ]);
  });

  it(`never returns more than ${MAX_POINTS} points`, () => {
    const many = Array.from({length: MAX_POINTS + 50}, (_, i) =>
      stored(`r${i}`, 'https://a.test/x', new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), 80)
    );
    expect(buildHistory(many, {limit: 1e9}).points).toHaveLength(MAX_POINTS);
    expect(buildHistory(many, {limit: -5}).points).toHaveLength(1);
  });

  it('leaves out damaged runs instead of throwing', () => {
    const damaged = [
      stored('ok', 'https://a.test/x', '2026-10-01T10:00:00Z', 70),
      {id: 'n', url: 'https://a.test/x', createdAt: '2026-10-01T10:00:00Z', summary: null},
      {
        id: 'u',
        url: 'not a url',
        createdAt: '2026-10-01T10:00:00Z',
        summary: stored('u', '', 'x', 1).summary,
      },
      stored('d', 'https://a.test/x', 'not a date', 70),
      stored('c', 'https://a.test/x', '2026-10-01T10:00:00Z', 70, {
        summary: {overall: {}, categories: 'no'},
      }),
      null,
    ];
    expect(buildHistory(damaged).points.map(p => p.runId)).toEqual(['ok']);
  });

  it('keeps a missing score as null', () => {
    const {points} = buildHistory([stored('1', 'https://a.test/', '2026-10-01T10:00:00Z', null)]);
    expect(points[0].score).toBeNull();
  });
});

describe('historyToCsv', () => {
  it('writes a header, one row per run and a column per category', () => {
    const csv = historyToCsv(
      buildHistory([stored('1', 'https://a.test/x', '2026-10-01T10:00:00Z', 70)]).points
    );
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe(
      'run,time,url,branch,commit,trigger,score,grade,failures,warnings,Metadata,Duplicates'
    );
    expect(row).toBe(
      `1,2026-10-01T10:00:00.000Z,https://a.test/x,main,${'a'.repeat(40)},webhook,70,F,2,1,70,`
    );
  });

  it('is only a header for no runs', () => {
    expect(historyToCsv([])).toBe(
      'run,time,url,branch,commit,trigger,score,grade,failures,warnings\r\n'
    );
  });

  it('quotes commas, quotes and newlines, and defuses spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    for (const f of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      expect(csvCell(f).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell(-5)).toBe("'-5");
    expect(csvCell(null)).toBe('');
    const hostile = stored('1', 'https://a.test/x', '2026-10-01T10:00:00Z', 70, {
      branch: '=cmd|calc',
    });
    expect(historyToCsv(buildHistory([hostile]).points)).toContain(",'=cmd|calc,");
  });
});

describe('compareStored', () => {
  const make = audits => serializeRun(summarizeRun(lhr(audits), RECOMMENDED));

  it('lists what is new, fixed and still failing between two stored runs', () => {
    const before = make({'canonical-https': audit(0), 'sitemap-valid': audit(1)});
    const after = make({'canonical-https': audit(1), 'sitemap-valid': audit(0)});
    const c = compareStored(JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)));
    expect(c.fixed.map(a => a.id)).toEqual(['canonical-https']);
    expect(c.newIssues.map(a => a.id)).toEqual(['sitemap-valid']);
  });

  it('is null when either run is unreadable', () => {
    const ok = make({'canonical-https': audit(1)});
    expect(compareStored(null, ok)).toBeNull();
    expect(compareStored(ok, {audits: 'x'})).toBeNull();
  });
});
