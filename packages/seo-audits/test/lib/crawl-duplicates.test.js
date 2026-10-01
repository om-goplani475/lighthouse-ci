/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildDuplicateProduct, keyOf} = require('../../src/lib/crawl-duplicates.js');

/** @param {any} over */
const page = (over = {}) => {
  const built = {
    url: 'https://example.com/',
    status: 200,
    title: 'Home',
    description: 'Welcome',
    source: 'link',
    extraction: 'ok',
    ...over,
  };
  if (!('finalUrl' in over)) built.finalUrl = built.url;
  return built;
};
/** @param {any[]} pages */
const artifact = pages => ({
  state: 'crawled',
  auditedUrl: 'https://example.com/',
  reason: null,
  snapshot: {pages},
  auditedRenderedTextLength: null,
});
const audited = (over = {}) => page({source: 'audited', ...over});

describe('keyOf', () => {
  it('trims and case-folds, and is empty for missing or blank values', () => {
    expect(keyOf('  Hello World ')).toBe('hello world');
    expect(keyOf('')).toBe('');
    expect(keyOf('   ')).toBe('');
    expect(keyOf(null)).toBe('');
    expect(keyOf(undefined)).toBe('');
  });
});

describe('buildDuplicateProduct', () => {
  it('fails when another crawled page has the same title, ignoring case and spaces', () => {
    const product = buildDuplicateProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited(), page({url: 'https://example.com/a', title: '  HOME '})]),
      'title'
    );
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('1 other page shares it');
    expect(product.details.items).toHaveLength(1);
    expect(product.details.items[0].url).toBe('https://example.com/a');
  });

  it('passes when the value is unique among the crawled pages', () => {
    const product = buildDuplicateProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited(), page({url: 'https://example.com/a', title: 'About'})]),
      'title'
    );
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('Unique among 2 crawled pages');
  });

  it('does not treat punctuation differences as duplicates', () => {
    const product = buildDuplicateProduct(
      // @ts-expect-error - partial test artifact
      artifact([
        audited({title: 'Home | Site'}),
        page({url: 'https://example.com/a', title: 'Home - Site'}),
      ]),
      'title'
    );
    expect(product.score).toBe(1);
  });

  it('works on descriptions independently of titles', () => {
    const pages = [
      audited(),
      page({url: 'https://example.com/a', title: 'About', description: 'welcome'}),
    ];
    // @ts-expect-error - partial test artifact
    expect(buildDuplicateProduct(artifact(pages), 'title').score).toBe(1);
    // @ts-expect-error - partial test artifact
    const product = buildDuplicateProduct(artifact(pages), 'description');
    expect(product.score).toBe(0);
    expect(product.explanation).toMatch(/meta description/);
  });

  it('is not applicable when the audited page has no value, however many pages are empty', () => {
    const product = buildDuplicateProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited({title: null}), page({url: 'https://example.com/a', title: null})]),
      'title'
    );
    expect(product.notApplicable).toBe(true);
    expect(product.explanation).toMatch(/no title/);
  });

  it('ignores other pages with empty values and pages that were not read as HTML', () => {
    const product = buildDuplicateProduct(
      artifact([
        audited(),
        // @ts-expect-error - partial test artifact
        page({url: 'https://example.com/a', title: ''}),
        page({url: 'https://example.com/b', extraction: 'skipped-not-html', title: 'Home'}),
        page({url: 'https://example.com/c', extraction: 'error', title: 'Home'}),
      ]),
      'title'
    );
    expect(product.score).toBe(1);
  });

  it('counts two requested URLs that end on one final URL as one page', () => {
    const product = buildDuplicateProduct(
      artifact([
        audited(),
        // @ts-expect-error - partial test artifact
        page({url: 'https://example.com/old', finalUrl: 'https://example.com/'}),
        page({url: 'https://example.com/a', title: 'About'}),
      ]),
      'title'
    );
    expect(product.score).toBe(1);
  });

  it('is not applicable when the crawl reached no other page', () => {
    // @ts-expect-error - partial test artifact
    const product = buildDuplicateProduct(artifact([audited()]), 'title');
    expect(product.notApplicable).toBe(true);
  });

  it('is not applicable when the audited page was not read as HTML', () => {
    const product = buildDuplicateProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited({extraction: 'error'}), page({url: 'https://example.com/a'})]),
      'title'
    );
    expect(product.notApplicable).toBe(true);
  });

  it.each([null, undefined, {}, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      const product = buildDuplicateProduct(input, 'title');
      expect(product.notApplicable).toBe(true);
    }
  );

  it('caps the rows and says how many were left out', () => {
    const many = Array.from({length: 80}, (_, i) => page({url: `https://example.com/p${i}`}));
    // @ts-expect-error - partial test artifact
    const product = buildDuplicateProduct(artifact([audited(), ...many]), 'title');
    expect(product.score).toBe(0);
    expect(product.details.items).toHaveLength(51);
    expect(product.details.items[50].url).toBe('30 more not shown');
  });

  it('clips a very long shared value', () => {
    const long = 'x'.repeat(5000);
    const product = buildDuplicateProduct(
      // @ts-expect-error - partial test artifact
      artifact([audited({title: long}), page({url: 'https://example.com/a', title: long})]),
      'title'
    );
    expect(product.details.items[0].value.length).toBeLessThan(110);
  });
});
