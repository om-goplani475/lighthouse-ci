/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildThinContentProduct, THIN_WORD_COUNT, MAX_ROWS} = require('../../src/lib/crawl-thin.js');

/** @param {any} over */
const page = (over = {}) => {
  const built = {
    url: 'https://example.com/',
    status: 200,
    bytes: 4000,
    truncated: false,
    textLength: 2000,
    wordCount: 350,
    source: 'link',
    extraction: 'ok',
    ...over,
  };
  if (!('finalUrl' in over)) built.finalUrl = built.url;
  return built;
};
const audited = (over = {}) => page({source: 'audited', ...over});
/**
 * @param {any[]} pages
 * @param {any} [extra]
 */
const artifact = (pages, extra = {}) => ({
  state: 'crawled',
  auditedUrl: 'https://example.com/',
  reason: null,
  snapshot: {pages},
  auditedRenderedTextLength: null,
  ...extra,
});

describe('buildThinContentProduct', () => {
  it('fails an audited page under the threshold and reports the ratio', () => {
    // @ts-expect-error - partial test artifact
    const product = buildThinContentProduct(
      artifact([audited({wordCount: 40, textLength: 240, bytes: 2400})])
    );
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('40 words');
    expect(product.explanation).toMatch(/40 words/);
    expect(product.details.items[0]).toMatchObject({
      words: 40,
      ratio: '10%',
      note: 'audited page, thin',
    });
  });

  it('passes at exactly the threshold and fails one word under it', () => {
    // @ts-expect-error - partial test artifact
    expect(buildThinContentProduct(artifact([audited({wordCount: THIN_WORD_COUNT})])).score).toBe(
      1
    );
    expect(
      // @ts-expect-error - partial test artifact
      buildThinContentProduct(artifact([audited({wordCount: THIN_WORD_COUNT - 1})])).score
    ).toBe(0);
  });

  it('uses the singular for one word', () => {
    // @ts-expect-error - partial test artifact
    expect(buildThinContentProduct(artifact([audited({wordCount: 1})])).displayValue).toBe(
      '1 word'
    );
  });

  it('never judges the ratio: a very low ratio still passes with enough words', () => {
    const product = buildThinContentProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited({wordCount: 500, textLength: 100, bytes: 500000})])
    );
    expect(product.score).toBe(1);
    expect(product.details.items[0].ratio).toBe('0%');
  });

  it('lists other thin pages without failing on them', () => {
    const product = buildThinContentProduct(
      artifact([
        audited(),
        // @ts-expect-error - partial test artifact
        page({url: 'https://example.com/a', wordCount: 10}),
        page({url: 'https://example.com/b', wordCount: 900}),
      ])
    );
    expect(product.score).toBe(1);
    expect(product.details.items.map((/** @type {any} */ i) => i.url)).toEqual([
      'https://example.com/',
      'https://example.com/a',
    ]);
  });

  it('mentions other thin pages in a failing explanation', () => {
    const product = buildThinContentProduct(
      artifact([
        audited({wordCount: 5}),
        // @ts-expect-error - partial test artifact
        page({url: 'https://example.com/a', wordCount: 10}),
      ])
    );
    expect(product.explanation).toMatch(/1 other crawled page is also under 200 words/);
  });

  it('skips unread, truncated and repeated pages in the other-pages list', () => {
    const product = buildThinContentProduct(
      artifact([
        audited(),
        // @ts-expect-error - partial test artifact
        page({url: 'https://example.com/e', extraction: 'error', wordCount: 0}),
        page({url: 'https://example.com/t', truncated: true, wordCount: 3}),
        page({url: 'https://example.com/old', finalUrl: 'https://example.com/', wordCount: 1}),
      ])
    );
    expect(product.details.items).toHaveLength(1);
  });

  it('caps the other-pages rows', () => {
    const many = Array.from({length: 80}, (_, i) =>
      page({url: `https://example.com/p${i}`, wordCount: 1})
    );
    // @ts-expect-error - partial test artifact
    const product = buildThinContentProduct(artifact([audited(), ...many]));
    expect(product.details.items).toHaveLength(1 + MAX_ROWS + 1);
    expect(product.details.items[MAX_ROWS + 1].url).toBe('30 more not shown');
  });

  it('is not applicable when a browser shows far more text than the server HTML', () => {
    const product = buildThinContentProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited({wordCount: 3, textLength: 20})], {auditedRenderedTextLength: 5000})
    );
    expect(product.notApplicable).toBe(true);
    expect(product.explanation).toMatch(/cannot be judged from server HTML/);
  });

  it('is not applicable for a truncated audited page that reads thin, but passes one that is long enough', () => {
    expect(
      // @ts-expect-error - partial test artifact
      buildThinContentProduct(artifact([audited({truncated: true, wordCount: 50})])).notApplicable
    ).toBe(true);
    expect(
      // @ts-expect-error - partial test artifact
      buildThinContentProduct(artifact([audited({truncated: true, wordCount: 5000})])).score
    ).toBe(1);
  });

  it('is not applicable when the audited page was not read as HTML', () => {
    // @ts-expect-error - partial test artifact
    expect(buildThinContentProduct(artifact([audited({extraction: 'error'})])).notApplicable).toBe(
      true
    );
  });

  it.each([null, undefined, {}, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(buildThinContentProduct(input).notApplicable).toBe(true);
    }
  );

  it('shows no ratio when no bytes were read and clips a long URL', () => {
    const product = buildThinContentProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited({bytes: 0, url: `https://example.com/${'x'.repeat(500)}`, wordCount: 1})])
    );
    expect(product.details.items[0].ratio).toBe('');
    expect(product.details.items[0].url.length).toBeLessThan(210);
  });
});
