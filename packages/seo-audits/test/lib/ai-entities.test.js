/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildEntitySignalsProduct, namesOf, normName} = require('../../src/lib/ai-entities.js');

const ld = (/** @type {any[]} */ ...objs) =>
  objs.map(o => ({content: JSON.stringify({'@context': 'https://schema.org', ...o})}));
const meta = (/** @type {any[]} */ items = []) => items;
const find = (/** @type {any} */ p, /** @type {string} */ signal) =>
  p.details.items.filter((/** @type {any} */ i) => i.signal === signal);

describe('namesOf and normName', () => {
  it('reads names from strings, objects and arrays', () => {
    expect(namesOf('Jane Doe')).toEqual([{name: 'Jane Doe', type: 'text'}]);
    expect(namesOf({'@type': 'Person', name: 'Jane'})).toEqual([{name: 'Jane', type: 'Person'}]);
    expect(namesOf([{name: 'A'}, 'B', {x: 1}, null, 5])).toEqual([
      {name: 'A', type: 'object'},
      {name: 'B', type: 'text'},
    ]);
    expect(namesOf(undefined)).toEqual([]);
  });
  it('compares site names ignoring case and punctuation', () => {
    expect(normName('Example, Inc.')).toBe(normName('example inc'));
  });
});

describe('buildEntitySignalsProduct (informational)', () => {
  it('reports author, publisher, sameAs, logo and a consistent site name', () => {
    const p = buildEntitySignalsProduct(
      ld(
        {
          '@type': 'Article',
          author: {'@type': 'Person', name: 'Jane Doe'},
          publisher: {'@type': 'Organization', name: 'Example'},
        },
        {
          '@type': 'Organization',
          name: 'Example',
          logo: 'https://example.com/l.png',
          sameAs: ['https://twitter.com/ex', 'https://www.linkedin.com/company/ex'],
        }
      ),
      meta([
        {property: 'og:site_name', content: 'Example'},
        {name: 'author', content: 'Jane Doe'},
      ]),
      [{rel: 'author', href: 'https://example.com/jane'}]
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('Author: 3 found, publisher: yes, sameAs links: 2');
    expect(find(p, 'Author').map((/** @type {any} */ i) => i.source)).toEqual([
      'JSON-LD Article author (Person)',
      '<meta name="author">',
      '<link rel="author">',
    ]);
    expect(find(p, 'Organization logo')[0].value).toBe('declared');
    expect(find(p, 'Site name')[0].value).toMatch(/^"Example" \(consistent in 2 places\)/);
    expect(find(p, 'sameAs links')[0].value).toBe('2 valid');
  });

  it('notes a site name that differs, and bad sameAs links', () => {
    const p = buildEntitySignalsProduct(
      ld({
        '@type': 'WebSite',
        name: 'Example Shop',
        sameAs: ['https://x.com/ex', 'x.com/ex', '/relative'],
      }),
      meta([{property: 'og:site_name', content: 'Totally Different'}]),
      []
    );
    expect(find(p, 'Site name')[0].value).toMatch(
      /^differs: "Example Shop" \(JSON-LD WebSite name\) \/ "Totally Different" \(og:site_name\)/
    );
    expect(find(p, 'sameAs links')[0].value).toMatch(
      /^1 valid, 2 not an absolute http\(s\) URL \(x\.com\/ex\)/
    );
  });

  it('reports a page with no signals, still without failing', () => {
    const p = buildEntitySignalsProduct([], meta(), []);
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('Author: none found, publisher: none found, sameAs links: 0');
    expect(find(p, 'Organization logo')[0].value).toBe('not declared');
    expect(p.details.items[p.details.items.length - 1].value).toMatch(/Descriptive only/);
  });

  it('ignores malformed items and is not applicable without the artifacts', () => {
    expect(
      buildEntitySignalsProduct([{content: 'not json'}, null], [null, {}], [null, {rel: 5}]).score
    ).toBe(1);
    expect(buildEntitySignalsProduct(null, [], []).notApplicable).toBe(true);
    expect(buildEntitySignalsProduct([], null, []).notApplicable).toBe(true);
    expect(buildEntitySignalsProduct([], [], undefined).notApplicable).toBe(true);
  });

  it('caps the rows', () => {
    const many = ld({
      '@type': 'Article',
      author: Array.from({length: 80}, (_, i) => ({name: `Author ${i}`})),
    });
    expect(buildEntitySignalsProduct(many, meta(), []).details.items.length).toBeLessThanOrEqual(
      41
    );
  });
});
