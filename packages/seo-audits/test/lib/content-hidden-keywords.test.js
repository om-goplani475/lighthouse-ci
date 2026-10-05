/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildHiddenTextProduct, MANY_WORDS} = require('../../src/lib/content-hidden.js');
const {
  buildKeywordAlignmentProduct,
  wordsOf,
  slugOf,
} = require('../../src/lib/content-keywords.js');

const base = {
  text: 'x',
  url: 'https://example.com/shop/red-running-shoes',
  title: 'Red Running Shoes for Men | Example',
  h1: ['Red running shoes'],
};

describe('buildHiddenTextProduct (informational)', () => {
  it('passes when nothing is hidden by a trick', () => {
    const p = buildHiddenTextProduct({...base, hiddenWords: 0, hiddenSamples: []});
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('No text hidden by styling tricks found');
  });
  it('reports a little hidden text calmly and a lot with a warning, never failing', () => {
    const few = buildHiddenTextProduct({
      ...base,
      hiddenWords: 1,
      hiddenSamples: [{reason: 'a font size of 2 px or less', text: 'cheap shoes'}],
    });
    expect(few.score).toBe(1);
    expect(few.displayValue).toBe('1 word hidden by styling');
    expect(few.details.items[0]).toEqual({how: 'a font size of 2 px or less', text: 'cheap shoes'});
    expect(few.details.items[1].text).toMatch(/small amount/);
    const many = buildHiddenTextProduct({...base, hiddenWords: MANY_WORDS, hiddenSamples: []});
    expect(many.details.items[0].text).toMatch(/lot of hidden text/);
  });
  it('is not applicable without the scan', () => {
    expect(buildHiddenTextProduct(null).notApplicable).toBe(true);
    expect(buildHiddenTextProduct(base).notApplicable).toBe(true);
    expect(buildHiddenTextProduct({...base, hiddenWords: 3, hiddenSamples: [null, {}]}).score).toBe(
      1
    );
  });
});

describe('keyword helpers', () => {
  it('drops stop words, short words and bare numbers, and folds a plural s', () => {
    expect([...wordsOf('The Red Shoes of the Year, in 2026')].sort()).toEqual([
      'red',
      'shoe',
      'year',
    ]);
    expect(wordsOf('Glass')).toEqual(new Set(['glass']));
    expect(wordsOf('Über Straße')).toEqual(new Set(['über', 'straße']));
  });
  it('turns a URL path into words', () => {
    expect(slugOf('https://example.com/blog/red-running_shoes.html')).toBe(
      ' blog red running shoes'
    );
    expect(slugOf('not a url')).toBe('');
  });
});

describe('buildKeywordAlignmentProduct (informational)', () => {
  it('lists the words shared by two or three sources', () => {
    const p = buildKeywordAlignmentProduct(base);
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('3 words are in all three, 0 in two');
    expect(p.details.items.map((/** @type {any} */ i) => i.word)).toEqual([
      'red',
      'running',
      'shoe',
    ]);
    expect(p.details.items[0]).toEqual({word: 'red', title: 'yes', h1: 'yes', url: 'yes'});
  });
  it('separates words in all three from words in two', () => {
    const p = buildKeywordAlignmentProduct({...base, h1: ['Running shoes']});
    expect(p.displayValue).toBe('2 words are in all three, 1 in two');
    expect(p.details.items[2]).toEqual({word: 'red', title: 'yes', h1: '', url: 'yes'});
  });
  it('shows the words when nothing is shared, and is not applicable with fewer than two sources', () => {
    const none = buildKeywordAlignmentProduct({
      ...base,
      url: 'https://example.com/products/12345',
      h1: ['Sneakers'],
    });
    expect(none.displayValue).toMatch(/No main word is shared/);
    expect(none.details.items.map((/** @type {any} */ i) => i.source)).toEqual([
      'Title',
      'First h1',
      'URL path',
    ]);
    expect(
      buildKeywordAlignmentProduct({...base, title: '', h1: [], url: 'https://example.com/'})
        .notApplicable
    ).toBe(true);
    expect(buildKeywordAlignmentProduct(null).notApplicable).toBe(true);
    expect(buildKeywordAlignmentProduct({text: 'x'}).notApplicable).toBe(true);
  });
});
