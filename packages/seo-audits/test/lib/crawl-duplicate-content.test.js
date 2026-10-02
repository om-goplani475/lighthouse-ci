/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildDuplicateContentProduct,
  baseKey,
  MIN_WORDS,
  MAX_ROWS,
} = require('../../src/lib/crawl-duplicate-content.js');

const mkUrl = (/** @type {string} */ p) => `https://example.com${p}`;
/** @param {any} over */
const page = (over = {}) => {
  const built = {
    url: mkUrl('/'),
    status: 200,
    canonicals: [],
    textHash: 'hash-1',
    wordCount: 300,
    truncated: false,
    source: 'link',
    extraction: 'ok',
    ...over,
  };
  if (!('finalUrl' in over)) built.finalUrl = built.url;
  return built;
};
const audited = (/** @type {any} */ over = {}) => page({source: 'audited', ...over});
/** @param {any[]} pages @param {any} [extra] */
const artifact = (pages, extra = {}) => ({
  state: 'crawled',
  auditedUrl: mkUrl('/'),
  reason: null,
  snapshot: {pages, skipped: []},
  auditedRenderedTextLength: null,
  ...extra,
});
/** @param {any[]} pages @param {any} [extra] */
const run = (pages, extra) =>
  // @ts-expect-error - partial test artifact
  buildDuplicateContentProduct(artifact(pages, extra));

describe('baseKey', () => {
  it('drops the query and trailing slashes only', () => {
    expect(baseKey('https://example.com/a/?x=1')).toBe('https://example.com/a');
    expect(baseKey('https://example.com/a')).toBe('https://example.com/a');
    expect(baseKey('https://example.com/b')).not.toBe(baseKey('https://example.com/a'));
    expect(baseKey('not a url')).toBe('not a url');
  });

  it('stays linear on a path made of many slashes', () => {
    const hostile = `https://example.com/${'/'.repeat(200000)}x`;
    const start = Date.now();
    expect(baseKey(hostile)).toBe(`https://example.com/${'/'.repeat(200000)}x`);
    expect(baseKey(`https://example.com/a${'/'.repeat(200000)}`)).toBe('https://example.com/a');
    // The quadratic regex took many seconds here.
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('buildDuplicateContentProduct', () => {
  it('fails when another crawled page has the same text hash', () => {
    const product = run([audited(), page({url: mkUrl('/copy')})]);
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('1 other page has identical text');
    expect(product.details.items[0]).toMatchObject({audited: 'yes', note: '', words: 300});
    expect(product.details.items[0].pages).toContain(mkUrl('/copy'));
  });

  it('passes when every page has different text', () => {
    const product = run([audited(), page({url: mkUrl('/a'), textHash: 'hash-2'})]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('No exact duplicates among 2 compared pages');
  });

  it('does not count a page that declares a canonical to another URL', () => {
    const product = run([audited(), page({url: mkUrl('/copy'), canonicals: [mkUrl('/')]})]);
    expect(product.score).toBe(1);
  });

  it('does not fail when the audited page itself declares a canonical to the other page', () => {
    const product = run([audited({canonicals: [mkUrl('/copy')]}), page({url: mkUrl('/copy')})]);
    expect(product.score).toBe(1);
  });

  it('still counts a page whose canonical points at itself', () => {
    const product = run([audited(), page({url: mkUrl('/copy'), canonicals: [mkUrl('/copy')]})]);
    expect(product.score).toBe(0);
  });

  it('notes duplicates that differ only by a trailing slash or query string', () => {
    const product = run([
      audited({url: mkUrl('/a')}),
      page({url: mkUrl('/a/')}),
      page({url: mkUrl('/a?utm=1')}),
    ]);
    expect(product.score).toBe(0);
    expect(product.details.items[0].note).toMatch(/trailing slash or query string/);
  });

  it('does not add that note when the paths differ', () => {
    expect(run([audited(), page({url: mkUrl('/other')})]).details.items[0].note).toBe('');
  });

  it('does not compare pages under the minimum word count', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/stub1'), textHash: 'stub', wordCount: MIN_WORDS - 1}),
      page({url: mkUrl('/stub2'), textHash: 'stub', wordCount: MIN_WORDS - 1}),
    ]);
    expect(product.notApplicable).toBe(true);
  });

  it('compares a page at exactly the minimum', () => {
    const product = run([
      audited({wordCount: MIN_WORDS}),
      page({url: mkUrl('/c'), wordCount: MIN_WORDS}),
    ]);
    expect(product.score).toBe(0);
  });

  it('is not applicable when the audited page itself is under the minimum', () => {
    const product = run([audited({wordCount: 3}), page({url: mkUrl('/c')})]);
    expect(product.notApplicable).toBe(true);
    expect(product.explanation).toMatch(/thin-content/);
  });

  it('lists duplicate groups on other pages without failing', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/a'), textHash: 'x'}),
      page({url: mkUrl('/b'), textHash: 'x'}),
    ]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('1 group of duplicates on other pages');
    expect(product.details.items[0].audited).toBe('');
  });

  it('puts the group with the audited page first and abbreviates a long group', () => {
    const many = Array.from({length: 6}, (_, i) => page({url: mkUrl(`/m${i}`), textHash: 'big'}));
    const product = run([...many, audited(), page({url: mkUrl('/copy')})]);
    expect(product.score).toBe(0);
    expect(product.details.items[0].audited).toBe('yes');
    expect(product.details.items[1].pages).toMatch(/and 3 more$/);
  });

  it('counts two requested URLs ending on one final URL as one page', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/old'), finalUrl: mkUrl('/')}),
      page({url: mkUrl('/a'), textHash: 'hash-2'}),
    ]);
    expect(product.score).toBe(1);
  });

  it('leaves out truncated, unreadable and hashless pages', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/t'), truncated: true}),
      page({url: mkUrl('/e'), extraction: 'error'}),
      page({url: mkUrl('/n'), textHash: null}),
      page({url: mkUrl('/a'), textHash: 'hash-2'}),
    ]);
    expect(product.score).toBe(1);
  });

  it('is not applicable when the audited page looks script-built', () => {
    const product = run([audited({wordCount: 60, textLength: 10}), page({url: mkUrl('/c')})], {
      auditedRenderedTextLength: 5000,
    });
    expect(product.notApplicable).toBe(true);
    expect(product.explanation).toMatch(/unreliable/);
  });

  it('is not applicable for a truncated audited page, a lone page or an unreadable audited page', () => {
    expect(run([audited({truncated: true}), page({url: mkUrl('/c')})]).notApplicable).toBe(true);
    expect(run([audited()]).notApplicable).toBe(true);
    expect(run([audited({extraction: 'error'}), page({url: mkUrl('/c')})]).notApplicable).toBe(
      true
    );
  });

  it('caps the rows', () => {
    const pages = [audited(), page({url: mkUrl('/copy')})];
    for (let i = 0; i < 80; i++) {
      pages.push(
        page({url: mkUrl(`/g${i}a`), textHash: `g${i}`}),
        page({url: mkUrl(`/g${i}b`), textHash: `g${i}`})
      );
    }
    const product = run(pages);
    expect(product.details.items).toHaveLength(MAX_ROWS + 1);
    expect(product.details.items[MAX_ROWS].pages).toBe('31 more groups not shown');
  });

  it.each([null, undefined, {}, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(buildDuplicateContentProduct(input).notApplicable).toBe(true);
    }
  );
});
