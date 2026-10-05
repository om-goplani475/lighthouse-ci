/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildReadabilityProduct,
  measure,
  syllables,
  MIN_WORDS,
} = require('../../src/lib/content-readability.js');

const simple =
  'The cat sat on the mat. The dog ran to the park. We like to play in the sun. It is a good day for a walk. '.repeat(
    6
  );
const hard =
  'Notwithstanding the aforementioned organizational considerations, interdepartmental communication fundamentally necessitates comprehensive institutional documentation. '.repeat(
    10
  );
const run = (/** @type {string} */ text, lang = 'en') => buildReadabilityProduct({text, lang});

describe('syllables and measure', () => {
  it('counts syllables roughly', () => {
    expect(syllables('cat')).toBe(1);
    expect(syllables('make')).toBe(1);
    expect(syllables('water')).toBe(2);
    expect(syllables('beautiful')).toBeGreaterThanOrEqual(3); // an approximation
    expect(syllables('communication')).toBeGreaterThanOrEqual(4);
    expect(syllables('')).toBe(0);
    expect(syllables('123')).toBe(0);
  });
  it('counts words and sentences, with a line break ending a sentence', () => {
    expect(measure('One two three. Four five!\nSix seven')).toMatchObject({words: 7, sentences: 3});
    expect(measure('').words).toBe(0);
  });
});

describe('buildReadabilityProduct (informational)', () => {
  it('scores easy text as easy and never fails', () => {
    const p = run(simple);
    expect(p.score).toBe(1);
    expect(p.displayValue).toMatch(/^Reading ease (8\d|9\d|1\d\d), grade/);
    expect(p.details.items[0].value).toMatch(/easy|very easy/);
  });

  it('scores dense text as difficult', () => {
    const p = run(hard);
    expect(p.displayValue).toMatch(/Reading ease -?\d+, grade \d{2}\./);
    expect(p.details.items[0].value).toMatch(/difficult/);
  });

  it('accepts en-GB and en_US as English and rejects other or missing languages', () => {
    expect(run(simple, 'en-GB').score).toBe(1);
    expect(run(simple, 'EN_us').notApplicable).toBeUndefined();
    expect(run(simple, 'fr').explanation).toMatch(
      /calibrated for English; this page declares lang="fr"/
    );
    expect(run(simple, '').explanation).toMatch(/does not declare its language/);
  });

  it('is not applicable for too little text or no content', () => {
    expect(run('Short text. Only two.').notApplicable).toBe(true);
    expect(
      run(
        Array(MIN_WORDS + 5)
          .fill('word')
          .join(' ')
      ).notApplicable
    ).toBe(true); // one sentence
    expect(buildReadabilityProduct(null).notApplicable).toBe(true);
  });

  it('stays fast on a huge single word', () => {
    const start = Date.now();
    run('a'.repeat(190000));
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
