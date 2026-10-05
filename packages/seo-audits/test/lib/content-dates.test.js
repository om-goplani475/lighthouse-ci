/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildContentDatesProduct,
  collectDates,
  parseTime,
} = require('../../src/lib/content-dates.js');

const NOW = '2026-10-05T12:00:00Z';
const ld = (/** @type {any} */ data) => [
  {content: JSON.stringify({'@context': 'https://schema.org', '@type': 'Article', ...data})},
];
const content = (/** @type {any[]} */ metaDates = []) => ({text: 'x', metaDates, times: []});
const meta = (/** @type {string} */ key, /** @type {string} */ value) => ({key, value});
const run = (/** @type {any} */ c, /** @type {any} */ j = []) =>
  buildContentDatesProduct(c, j, NOW);

describe('parseTime', () => {
  it('reads ISO dates and rejects junk and absurd years', () => {
    expect(parseTime('2026-03-01T10:00:00+02:00')).toBe(Date.parse('2026-03-01T08:00:00Z'));
    expect(parseTime('2026-03-01')).toBe(Date.parse('2026-03-01T00:00:00Z'));
    expect(parseTime('soon')).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime('1850-01-01')).toBeNull();
    expect(parseTime(5)).toBeNull();
  });
});

describe('collectDates', () => {
  it('reads meta tags and JSON-LD (also inside a @graph) and lists unreadable values', () => {
    const {dates, unreadable} = collectDates(
      content([
        meta('article:published_time', '2026-01-01'),
        meta('last-modified', 'not a date'),
        meta('other', '2026-01-01'),
      ]),
      [
        {
          content: JSON.stringify({
            '@graph': [
              {'@type': 'WebPage', datePublished: '2026-01-01', dateModified: '2026-02-01'},
            ],
          }),
        },
        {content: 'not json'},
        null,
      ]
    );
    expect(dates.map(d => `${d.kind}:${d.source}`)).toEqual([
      'published:<meta article:published_time>',
      'published:JSON-LD WebPage datePublished',
      'modified:JSON-LD WebPage dateModified',
    ]);
    expect(unreadable).toEqual(['<meta last-modified>: not a date']);
  });
});

describe('buildContentDatesProduct', () => {
  it('passes consistent dates and shows the age', () => {
    const p = run(
      content([
        meta('article:published_time', '2026-01-01T00:00:00Z'),
        meta('article:modified_time', '2026-09-25T00:00:00Z'),
      ])
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('Last modified 2026-09-25 (10 days ago)');
  });

  it('passes a published date alone, and agreeing meta and JSON-LD, within a day of tolerance', () => {
    expect(
      run(
        content([meta('article:published_time', '2026-01-01T23:00:00Z')]),
        ld({datePublished: '2026-01-02T01:00:00Z'})
      ).score
    ).toBe(1);
    expect(run(content([meta('datePublished', '2026-01-01')])).displayValue).toMatch(
      /^Published 2026-01-01/
    );
  });

  it('fails a modified date before the published date', () => {
    const p = run(
      content([
        meta('article:published_time', '2026-05-01'),
        meta('article:modified_time', '2026-03-01'),
      ])
    );
    expect(p.score).toBe(0);
    expect(p.details.items[0].value).toMatch(
      /modified date 2026-03-01 .* is before the published date 2026-05-01/
    );
  });

  it('fails a date in the future, even with a day of slack, and passes tomorrow', () => {
    expect(run(content([meta('article:published_time', '2026-12-01')])).score).toBe(0);
    expect(run(content([meta('article:published_time', '2026-10-06T00:00:00Z')])).score).toBe(1);
  });

  it('fails two different published dates between meta and JSON-LD', () => {
    const p = run(
      content([meta('article:published_time', '2026-01-01')]),
      ld({datePublished: '2026-02-15'})
    );
    expect(p.score).toBe(0);
    expect(p.details.items[0].value).toBe(
      'two different published dates are declared (2026-01-01 and 2026-02-15)'
    );
  });

  it('does not judge visible time elements', () => {
    const c = {
      text: 'x',
      metaDates: [meta('article:published_time', '2026-01-01')],
      times: [{datetime: '2030-01-01', text: 'event'}],
    };
    expect(run(c).score).toBe(1);
  });

  it('is not applicable without dates, says when they are unreadable, and handles bad input', () => {
    expect(run(content()).explanation).toBe('The page declares no published or modified date.');
    expect(run(content([meta('date', 'someday')])).explanation).toMatch(/could not read/);
    expect(run(null).notApplicable).toBe(true);
    // @ts-expect-error - deliberately wrong input
    expect(run({text: 'x', metaDates: 5}, 'nope').notApplicable).toBe(true);
    expect(
      buildContentDatesProduct(content([meta('date', '2026-01-01')]), [], 'bad time').score
    ).toBe(1);
  });
});
