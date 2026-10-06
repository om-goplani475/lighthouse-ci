/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const lib = require('../../src/lib/images.js');

const alt = (over = {}) => ({
  src: 'https://example.com/img/red-shoes.jpg',
  alt: 'Red running shoes on a track',
  hidden: false,
  decorative: false,
  width: 300,
  height: 200,
  ...over,
});
const el = (over = {}) => ({
  src: 'https://example.com/img/red-shoes.jpg',
  displayedWidth: 300,
  displayedHeight: 200,
  attributeWidth: '300',
  attributeHeight: '200',
  naturalDimensions: {width: 300, height: 200},
  clientRect: {top: 2000, bottom: 2200, left: 0, right: 300},
  isCss: false,
  loading: undefined,
  ...over,
});
const rec = (over = {}) => ({
  url: 'https://example.com/a.webp',
  resourceType: 'Image',
  statusCode: 200,
  mimeType: 'image/webp',
  resourceSize: 50000,
  failed: false,
  ...over,
});

describe('buildAltQualityProduct', () => {
  const run = (/** @type {any[]} */ images) => lib.buildAltQualityProduct({images});

  it('passes meaningful alt text and treats alt="" as decorative', () => {
    const p = run([alt(), alt({src: 'https://example.com/b.jpg', alt: ''})]);
    expect(p.score).toBe(1);
  });
  it('fails a file name, a repeated file name, a placeholder and a long alt', () => {
    const p = run([
      alt({src: 'https://example.com/a.jpg', alt: 'IMG_1234.jpg'}),
      alt({src: 'https://example.com/red-shoes.png', alt: 'red-shoes'}),
      alt({src: 'https://example.com/c.jpg', alt: 'Image.'}),
      alt({src: 'https://example.com/d.jpg', alt: 'photo 3'}),
      alt({src: 'https://example.com/e.jpg', alt: 'x'.repeat(lib.MAX_ALT_CHARS + 1)}),
    ]);
    expect(p.score).toBe(0);
    expect(p.details.items.map((/** @type {any} */ i) => i.problem)).toEqual([
      'the alt text is a file name',
      'the alt text repeats the file name',
      'the alt text is a placeholder word',
      'the alt text is a placeholder word',
      expect.stringMatching(/126 characters/),
    ]);
  });
  it('only notes the same alt text on three different images, not on two', () => {
    const three = ['a', 'b', 'c'].map(n =>
      alt({src: `https://example.com/${n}.jpg`, alt: 'Our product'})
    );
    const repeated = run(three);
    expect(repeated.score).toBe(1);
    expect(repeated.details.items[0].problem).toMatch(/^note: the same alt text/);
    expect(run(three.slice(0, 2)).score).toBe(1);
    expect(run([three[0], three[0], three[0]]).score).toBe(1); // one source
  });
  it('ignores small, hidden, decorative and missing-alt images (core covers a missing alt)', () => {
    const p = run([
      alt({width: 20, alt: 'image'}),
      alt({hidden: true, alt: 'image'}),
      alt({decorative: true, alt: 'image'}),
      alt({alt: null}),
    ]);
    expect(p.notApplicable).toBe(true);
  });
  it('is not applicable without data', () => {
    expect(lib.buildAltQualityProduct(null).notApplicable).toBe(true);
    expect(lib.buildAltQualityProduct({images: [null, {src: 5}]}).notApplicable).toBe(true);
  });
});

describe('buildFilenameProduct', () => {
  const run = (/** @type {any[]} */ els) => lib.buildFilenameProduct(els);
  const named = (/** @type {string} */ f, over = {}) =>
    el({src: `https://example.com/i/${f}`, ...over});

  it('passes descriptive names', () => {
    expect(run([named('red-running-shoes.jpg')]).score).toBe(1);
  });
  it('fails camera names, numbers, hashes, uuids and generic words', () => {
    const p = run([
      named('IMG_1234.jpg'),
      named('DSC00012.png'),
      named('Screenshot 2026-01-01.png'),
      named('12345.jpg'),
      named('9f86d081884c7d659a2feaa0c55ad015.jpg'),
      named('123e4567-e89b-12d3-a456-426614174000.webp'),
      named('banner.png'),
    ]);
    expect(p.details.items).toHaveLength(7);
  });
  it('reads CSS backgrounds too, dedupes by URL, and skips small and data images', () => {
    const p = run([
      named('IMG_1.jpg', {isCss: true}),
      named('IMG_1.jpg'),
      named('IMG_2.jpg', {displayedWidth: 10}),
      el({src: 'data:image/png;base64,AAAA'}),
    ]);
    expect(p.details.items).toHaveLength(1);
  });
  it('is not applicable without content images', () => {
    expect(run([named('a.jpg', {displayedWidth: 5})]).notApplicable).toBe(true);
    expect(lib.buildFilenameProduct(null).notApplicable).toBe(true);
  });
  it('decodes names and survives a malformed escape', () => {
    expect(lib.baseName('https://example.com/a/red%20shoes.jpg')).toBe('red shoes');
    expect(lib.baseName('https://example.com/a/%E0%A4%A.jpg')).toBe('%E0%A4%A');
    expect(lib.baseName('not a url/x.png')).toBe('x');
  });
});

describe('buildLazyAboveFoldProduct', () => {
  const vp = {innerHeight: 800};
  const run = (/** @type {any[]} */ els, v = vp) => lib.buildLazyAboveFoldProduct(els, v);

  it('fails a lazy image inside the first screen', () => {
    const p = run([
      el({loading: 'lazy', clientRect: {top: 100, bottom: 300, left: 0, right: 300}}),
    ]);
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toMatch(/100 px from the top of a 800 px viewport/);
  });
  it('passes a carousel slide that sits to the right of the screen, and fails one that is on it', () => {
    const wide = {innerHeight: 800, innerWidth: 1000};
    const slide = (/** @type {number} */ left) =>
      el({loading: 'lazy', clientRect: {top: 100, bottom: 300, left, right: left + 300}});
    expect(run([slide(1000), slide(1300)], wide).score).toBe(1);
    expect(run([slide(-800)], wide).score).toBe(1);
    expect(run([slide(900)], wide).score).toBe(0);
    // an unknown width falls back to the vertical test alone
    expect(run([slide(5000)], vp).score).toBe(0);
  });
  it('passes lazy images below the fold, eager images and CSS images', () => {
    expect(run([el({loading: 'lazy'})]).score).toBe(1);
    expect(run([el({loading: 'eager', clientRect: {top: 0, bottom: 100}})]).displayValue).toMatch(
      /No image uses/
    );
    expect(
      run([el({loading: 'lazy', isCss: true, clientRect: {top: 0, bottom: 100}})]).displayValue
    ).toMatch(/No image uses/);
  });
  it('ignores a hidden (zero-size) lazy image', () => {
    const p = run([el({loading: 'lazy', displayedWidth: 0, clientRect: {top: 0, bottom: 0}})]);
    expect(p.score).toBe(1);
  });
  it('is not applicable without images or a viewport', () => {
    expect(lib.buildLazyAboveFoldProduct(null, vp).notApplicable).toBe(true);
    expect(run([el()], {}).notApplicable).toBe(true);
  });
});

describe('buildDimensionsProduct', () => {
  const run = (/** @type {any[]} */ els) => lib.buildDimensionsProduct(els);
  it('fails an image with a missing attribute and names which', () => {
    const p = run([
      el({attributeHeight: null}),
      el({src: 'https://example.com/b.jpg', attributeWidth: '', attributeHeight: null}),
    ]);
    expect(p.details.items.map((/** @type {any} */ i) => i.problem)).toEqual([
      'no height (attribute or CSS)',
      'no width or height (attribute or CSS)',
    ]);
  });
  it('accepts CSS sizes and an aspect ratio, as core unsized-images does', () => {
    const css = (/** @type {any} */ rules, over = {}) =>
      el({attributeWidth: null, attributeHeight: null, cssEffectiveRules: rules, ...over});
    expect(run([css({width: '300px', height: '200px', aspectRatio: null})]).score).toBe(1);
    expect(run([css({width: '100%', height: 'auto', aspectRatio: '3 / 2'})]).score).toBe(1);
    expect(run([css({width: 'auto', height: 'auto', aspectRatio: null})]).score).toBe(0);
    // fixed and absolute images are out of the flow; unknown CSS rules are not guessed
    expect(
      run([css({width: 'auto', height: 'auto'}, {computedStyles: {position: 'fixed'}})]).score
    ).toBe(1);
  });
  it('passes sized, small and CSS images; is not applicable with none to judge', () => {
    expect(run([el()]).score).toBe(1);
    expect(run([el({attributeWidth: null, displayedWidth: 10})]).notApplicable).toBe(true);
    expect(run([el({isCss: true, attributeWidth: null})]).notApplicable).toBe(true);
  });
});

describe('buildOversizedProduct', () => {
  const run = (/** @type {any[]} */ els, /** @type {string} */ page) =>
    lib.buildOversizedProduct(els, page);
  it('fails an image over 3x wider and 100 px wider than shown', () => {
    const p = run([el({naturalDimensions: {width: 1200, height: 800}})]);
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toBe('1200 px wide, shown at 300 px (4.0x)');
  });
  it('passes retina-sized images, small absolute excess and SVG', () => {
    expect(run([el({naturalDimensions: {width: 600, height: 400}})]).score).toBe(1);
    expect(
      run([el({displayedWidth: 60, naturalDimensions: {width: 150, height: 100}})]).score
    ).toBe(1);
    expect(
      run([el({src: 'https://example.com/a.svg', naturalDimensions: {width: 5000, height: 5000}})])
        .notApplicable
    ).toBe(true);
  });
  it('passes an image at 2.5x, normal for a 2x asset', () => {
    expect(run([el({naturalDimensions: {width: 750, height: 500}})]).score).toBe(1);
  });
  it('only notes an oversized image served by another site', () => {
    const ad = el({
      src: 'https://ads.tracker.net/b.jpg',
      naturalDimensions: {width: 1200, height: 800},
    });
    const page = 'https://www.example.com/';
    const p = run([ad], page);
    expect(p.score).toBe(1);
    expect(p.details.items[0].problem).toMatch(/^note: .*served by another site/);
    // a CDN subdomain of the same site is first party
    const cdn = el({
      src: 'https://cdn.example.com/b.jpg',
      naturalDimensions: {width: 1200, height: 800},
    });
    expect(run([cdn], page).score).toBe(0);
  });
  it('skips images with no natural size', () => {
    expect(run([el({naturalDimensions: undefined})]).notApplicable).toBe(true);
  });
});

describe('network based audits', () => {
  it('legacy formats: fails big JPEG/PNG/GIF, passes WebP, AVIF, SVG and small files', () => {
    const p = lib.buildLegacyFormatProduct([
      rec({url: 'https://example.com/a.jpg', mimeType: 'image/jpeg', resourceSize: 200 * 1024}),
      rec({
        url: 'https://example.com/b.png',
        mimeType: 'image/png',
        resourceSize: lib.LEGACY_MIN_BYTES + 1,
      }),
      rec({url: 'https://example.com/c.png', mimeType: 'image/png', resourceSize: 2000}),
      rec({url: 'https://example.com/d.avif', mimeType: 'image/avif'}),
      rec({url: 'https://example.com/e.svg', mimeType: 'image/svg+xml'}),
      rec({
        url: 'https://example.com/f.jpg',
        mimeType: 'image/jpeg',
        resourceSize: 999999,
        statusCode: 404,
      }),
      rec({url: 'data:image/png;base64,AAAA', mimeType: 'image/png', resourceSize: 999999}),
    ]);
    expect(p.score).toBe(0);
    expect(p.details.items.map((/** @type {any} */ i) => i.url)).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.png',
    ]);
    expect(p.details.items[0].problem).toBe('JPEG of 200 KiB; WebP or AVIF is smaller');
    expect(lib.buildLegacyFormatProduct([rec()]).score).toBe(1);
  });
  it('broken images: fails 4xx/5xx and no-response, ignores aborted and non-images', () => {
    const p = lib.buildFailedImagesProduct([
      rec({url: 'https://example.com/a.jpg', statusCode: 404}),
      rec({url: 'https://example.com/b.jpg', statusCode: 500}),
      rec({
        url: 'https://example.com/c.jpg',
        statusCode: -1,
        failed: true,
        localizedFailDescription: 'net::ERR_CONNECTION_REFUSED',
      }),
      rec({
        url: 'https://example.com/d.jpg',
        statusCode: -1,
        failed: true,
        localizedFailDescription: 'net::ERR_ABORTED',
      }),
      rec({url: 'https://example.com/e.js', resourceType: 'Script', statusCode: 404}),
      rec({url: 'https://example.com/ok.png'}),
    ]);
    expect(p.score).toBe(0);
    expect(p.details.items.map((/** @type {any} */ i) => i.problem)).toEqual([
      'answered 404',
      'answered 500',
      'no response (net::ERR_CONNECTION_REFUSED)',
    ]);
    expect(lib.buildFailedImagesProduct([rec()]).displayValue).toBe(
      'All 1 image requests succeeded'
    );
  });
  it('failed images from another site are only notes', () => {
    const page = 'https://www.example.com/';
    const third = lib.buildFailedImagesProduct(
      [rec({url: 'https://ads.tracker.net/a.gif', statusCode: 404})],
      page
    );
    expect(third.score).toBe(1);
    expect(third.details.items[0].problem).toBe('note: answered 404 (another site)');
    const own = lib.buildFailedImagesProduct(
      [rec({url: 'https://cdn.example.com/a.gif', statusCode: 404})],
      page
    );
    expect(own.score).toBe(0);
  });
  it('are not applicable without records or images', () => {
    expect(lib.buildFailedImagesProduct(null).notApplicable).toBe(true);
    expect(lib.buildFailedImagesProduct([]).notApplicable).toBe(true);
    expect(lib.buildLegacyFormatProduct([rec({failed: true})]).notApplicable).toBe(true);
    expect(lib.buildLegacyFormatProduct(undefined).notApplicable).toBe(true);
  });
});

describe('row cap', () => {
  it('shows at most 50 rows and counts the rest', () => {
    const els = Array.from({length: lib.MAX_ROWS + 4}, (_, i) =>
      el({src: `https://example.com/IMG_${i + 1}.jpg`})
    );
    const p = lib.buildFilenameProduct(els);
    expect(p.details.items).toHaveLength(lib.MAX_ROWS + 1);
    expect(p.details.items[lib.MAX_ROWS].url).toBe('4 more not shown');
  });
});
