/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildVariantProduct,
  normalForm,
  MAX_GROUPS,
} = require('../../src/lib/crawl-url-variants.js');

const page = (url, over = {}) => ({
  url,
  finalUrl: url,
  extraction: 'ok',
  status: 200,
  source: 'link',
  canonicals: [],
  ...over,
});
const audited = (url, over = {}) => page(url, {source: 'audited', ...over});
/** @param {any[]} pages */
const artifact = pages => ({state: 'crawled', auditedUrl: 'x', reason: null, snapshot: {pages}});
/**
 * @param {any[]} pages
 * @param {'case' | 'slash' | 'any'} kind
 */
// @ts-expect-error - partial test artifacts
const run = (pages, kind) => buildVariantProduct(artifact(pages), kind);

describe('normalForm', () => {
  it('folds case, trailing and repeated slashes, index files, tracking and session params, param order', () => {
    const key = 'https://example.com/shop/item?a=1&b=2';
    expect(normalForm('https://example.com/Shop//Item/?b=2&a=1&utm_source=x&PHPSESSID=z')).toBe(
      key
    );
    expect(normalForm('https://example.com/shop/item/index.html?b=2&a=1')).toBe(key);
    expect(normalForm('https://example.com/shop/item?a=1&b=2')).toBe(key);
  });
  it('keeps real parameters and the root distinct', () => {
    expect(normalForm('https://example.com/?page=2')).not.toBe(normalForm('https://example.com/'));
    expect(normalForm('https://example.com/index.php')).toBe(normalForm('https://example.com/'));
  });
  it('stays linear on a very long run of slashes', () => {
    const start = Date.now();
    normalForm(`https://example.com/a${'/'.repeat(200000)}x`);
    normalForm(`https://example.com/${'/'.repeat(200000)}`);
    expect(Date.now() - start).toBeLessThan(2500);
  });
  it('returns null for an unparseable URL', () => {
    expect(normalForm('nope')).toBeNull();
  });
});

describe('case and slash variants', () => {
  it('fails the audited page that has a live case twin', () => {
    const p = run(
      [audited('https://example.com/About'), page('https://example.com/about')],
      'case'
    );
    expect(p.score).toBe(0);
    expect(p.details.items).toHaveLength(2);
    expect(p.details.items[0].page).toBe('audited page');
    expect(p.explanation).toMatch(/differ only in upper and lower case/);
  });

  it('fails the audited page that has a trailing-slash twin, and only the slash audit sees it', () => {
    const pages = [audited('https://example.com/a'), page('https://example.com/a/')];
    expect(run(pages, 'slash').score).toBe(0);
    expect(run(pages, 'case').displayValue).toMatch(/No letter case variants/);
    expect(run(pages, 'any').score).toBe(0);
  });

  it('passes when both name one canonical', () => {
    const c = ['https://example.com/a'];
    const p = run(
      [
        audited('https://example.com/a', {canonicals: c}),
        page('https://example.com/a/', {canonicals: c}),
      ],
      'slash'
    );
    expect(p.score).toBe(1);
  });

  it('passes when one has a canonical to the other, and fails when they name different ones', () => {
    expect(
      run(
        [
          audited('https://example.com/a'),
          page('https://example.com/a/', {canonicals: ['https://example.com/a']}),
        ],
        'slash'
      ).score
    ).toBe(1); // both resolve to /a
    expect(
      run(
        [
          audited('https://example.com/a', {canonicals: ['https://example.com/a']}),
          page('https://example.com/a/', {canonicals: ['https://example.com/a/']}),
        ],
        'slash'
      ).score
    ).toBe(0);
  });

  it('lists groups that do not involve the audited page without failing', () => {
    const p = run(
      [
        audited('https://example.com/'),
        page('https://example.com/x'),
        page('https://example.com/X'),
      ],
      'case'
    );
    expect(p.score).toBe(1);
    expect(p.details.items.map(i => i.page)).toEqual(['other crawled page', 'other crawled page']);
    expect(p.displayValue).toMatch(/1 letter case group on other pages/);
  });

  it('ignores variants that are not live HTML answers and counts a final URL once', () => {
    const pages = [
      audited('https://example.com/a'),
      page('https://example.com/A', {status: 404}),
      page('https://example.com/a/', {extraction: 'skipped-not-html'}),
      page('https://example.com/a', {url: 'https://example.com/a#x'}),
    ];
    expect(run(pages, 'any').score).toBe(1);
  });

  it('finds tracking-parameter and index-file duplicates under any, not under case or slash', () => {
    const pages = [audited('https://example.com/p'), page('https://example.com/p?utm_source=a')];
    expect(run(pages, 'any').score).toBe(0);
    expect(run(pages, 'case').score).toBe(1);
    expect(run(pages, 'slash').score).toBe(1);
  });
});

describe('applicability', () => {
  it('is not applicable when the crawl did not run or reached one page', () => {
    // @ts-expect-error - deliberately wrong input
    expect(buildVariantProduct(null, 'any').notApplicable).toBe(true);
    // @ts-expect-error - partial test artifact
    expect(buildVariantProduct({state: 'disabled', reason: 'off'}, 'any').notApplicable).toBe(true);
    // @ts-expect-error - partial test artifact
    expect(buildVariantProduct({state: 'crawled', snapshot: null}, 'any').notApplicable).toBe(true);
    expect(run([audited('https://example.com/')], 'any').notApplicable).toBe(true);
  });

  it('caps the groups shown', () => {
    const pages = [audited('https://example.com/')];
    for (let i = 0; i < MAX_GROUPS + 3; i++) {
      pages.push(page(`https://example.com/g${i}`), page(`https://example.com/G${i}`));
    }
    const p = run(pages, 'case');
    expect(p.details.items[p.details.items.length - 1].url).toBe('3 more groups not shown');
  });
});
