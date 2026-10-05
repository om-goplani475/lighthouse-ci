/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildPlaceholderProduct} = require('../../src/lib/content-placeholder.js');

const content = (/** @type {string} */ text, title = 'A real title') => ({text, title});
const run = (/** @type {any} */ c) => buildPlaceholderProduct(c);

describe('buildPlaceholderProduct', () => {
  it('passes real text, including the words coming soon and sample', () => {
    const p = run(
      content(
        'Our new range is coming soon. Download a sample of the report. Placeholders in CSS are useful.'
      )
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('No placeholder text found');
  });

  it('fails lorem ipsum filler and shows where', () => {
    const p = run(
      content('Welcome. Lorem ipsum dolor sit amet, consectetur adipiscing elit. More text.')
    );
    expect(p.score).toBe(0);
    expect(p.details.items[0].kind).toMatch(/^lorem ipsum filler text/);
    expect(p.details.items[0].text).toMatch(/Lorem ipsum/i);
  });

  it.each([
    ['Your text here', /template prompt/],
    ['insert content here to begin', /template prompt/],
    ['Page title goes here', /unedited template prompt/],
    ['Click here to edit this text', /unedited template prompt/],
    ['Hello {{ user.name }}, welcome', /unfilled template tag \(\{\{/],
    ['Total: <%= total %>', /unfilled template tag \(<%/],
  ])('fails %j', (text, kind) => {
    expect(run(content(text)).details.items[0].kind).toMatch(kind);
  });

  it('also reads the title', () => {
    expect(run(content('Fine text here and there.', 'Lorem ipsum dolor')).score).toBe(0);
  });

  it('reports one row per kind with the number of matches', () => {
    const text = Array.from({length: 40}, () => 'lorem ipsum {{ a }} <%= b %> your text here').join(
      ' '
    );
    const p = run(content(text));
    expect(p.details.items).toHaveLength(4);
    expect(p.details.items[0].kind).toBe('lorem ipsum filler text (40 matches)');
    expect(run(content('Lorem ipsum once.')).details.items).toEqual([
      {kind: 'lorem ipsum filler text', text: expect.stringContaining('Lorem ipsum')},
    ]);
  });

  it('is not applicable without content or text, and stays fast on hostile text', () => {
    expect(run(null).notApplicable).toBe(true);
    expect(run(content('   ', '')).notApplicable).toBe(true);
    const start = Date.now();
    run(content(`{{${' '.repeat(190000)}`));
    run(content(`<%${'='.repeat(190000)}`));
    run(content('{{ x '.repeat(30000)));
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
