/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {summarizeRun} = require('../../src/summary/run-summary.js');
const {compareAll} = require('../../src/summary/compare.js');
const {renderMarkdown, toData, cell} = require('../../src/summary/render.js');
const {RECOMMENDED, audit, lhr} = require('./fixtures.js');

const CATEGORIES = [
  {name: 'Metadata', audits: ['canonical-https', 'document-title-quality']},
  {name: 'Duplicates', audits: ['sitemap-valid', 'duplicate-titles']},
];
const run = (/** @type {any} */ audits, /** @type {any} */ opts) =>
  summarizeRun(lhr(audits, opts), RECOMMENDED, CATEGORIES);

describe('cell', () => {
  it('escapes pipes and angle brackets, flattens whitespace and clips', () => {
    expect(cell('a | b\n<script>')).toBe('a \\| b &lt;script&gt;');
    expect(cell('x'.repeat(500)).length).toBeLessThanOrEqual(143);
    expect(cell(undefined)).toBe('');
    // a page cannot plant a link or a code span in the summary
    expect(cell('[click](https://evil.test) `x`')).toBe("\\[click\\](https://evil.test) 'x'");
  });
});

describe('renderMarkdown', () => {
  const failing = run({
    'canonical-https': audit(0, {displayValue: 'bad | value', numericValue: 3}),
    'document-title-quality': audit(1),
    'sitemap-valid': audit(1),
    'duplicate-titles': audit(0.5, {explanation: 'two pages share a title'}),
  });

  it('shows the overall score, a category table, the ranked issues and fix guidance', () => {
    const md = renderMarkdown({runs: [failing]});
    expect(md).toMatch(/^# SEO summary/);
    expect(md).toMatch(/\*\*Overall: \d+\.\d \(grade [A-F]\)\*\*/);
    expect(md).toContain('| Metadata |');
    expect(md).toContain('### Issues, most important first (2 of 2)');
    expect(md.indexOf('canonical-https')).toBeLessThan(md.indexOf('duplicate-titles'));
    expect(md).toContain('bad \\| value');
    expect(md).toContain('### How to fix the top issues');
    expect(md).toContain('What is wrong: two pages share a title');
  });

  it('says so when nothing failed, and honours --top and --guidance 0', () => {
    const clean = run({'canonical-https': audit(1)});
    expect(renderMarkdown({runs: [clean]})).toContain('**No issues.**');
    const limited = renderMarkdown({runs: [failing], top: 1, guidance: 0});
    expect(limited).toContain('(1 of 2)');
    expect(limited).not.toContain('How to fix');
  });

  it('shows a page table when there are several pages, and a message when there are none', () => {
    const md = renderMarkdown({runs: [failing, run({}, {url: 'https://b.test/'})]});
    expect(md).toContain('| Page | Score | Grade | Errors | Warnings |');
    expect(renderMarkdown({runs: []})).toMatch(/No report was found/);
  });

  it('renders the comparison, with new, fixed and unpaired pages', () => {
    const before = [
      run({'canonical-https': audit(1), 'duplicate-titles': audit(0)}),
      run({}, {url: 'https://gone.test/'}),
    ];
    const {comparisons, onlyInBefore, onlyInAfter} = compareAll(before, [
      failing,
      run({}, {url: 'https://new.test/'}),
    ]);
    const md = renderMarkdown({
      runs: [failing, run({}, {url: 'https://new.test/'})],
      comparisons,
      onlyInBefore,
      onlyInAfter,
    });
    expect(md).toContain('### Compared with the earlier run');
    expect(md).toContain('**New issues (1)**');
    expect(md).toContain('`canonical-https`');
    expect(md).toContain('**Still failing (1)**');
    expect(md).toContain('New pages with no earlier run: https://new.test/');
    expect(md).toContain('Pages in the earlier run but not this one: https://gone.test/');
  });
});

describe('toData', () => {
  it('returns plain data that survives JSON', () => {
    const data = toData({runs: [run({'canonical-https': audit(0)})]});
    const roundTrip = JSON.parse(JSON.stringify(data));
    expect(roundTrip.runs[0].issues[0].id).toBe('canonical-https');
    expect(roundTrip.runs[0].categories).toHaveLength(2);
    expect(roundTrip.comparisons).toEqual([]);
  });
});
