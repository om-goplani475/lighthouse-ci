/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildSerpPreview,
  compareSerpPreviews,
  reviveSerpPreview,
  cutToBudget,
  displayUrlOf,
  fontSizePx,
} = require('../../src/lib/serp-preview.js');

/** A fake font where every character is `w` pixels wide. */
const measure = (text, w = 10) => ({
  text,
  widthPx: Array.from(text).length * w,
  prefixWidths: Array.from(text)
    .slice(0, 400)
    .map((_, i) => (i + 1) * w),
});

const BUDGETS = {
  title: {desktop: 600, mobile: 580},
  description: {desktop: 920, mobile: 680},
};
const FONTS = {title: '400 20px Arial, sans-serif', description: '400 14px Arial, sans-serif'};

describe('cutToBudget', () => {
  it('leaves a text that fits exactly as it is', () => {
    expect(cutToBudget(measure('Short title'), 600, 20)).toEqual({
      shown: 'Short title',
      truncated: false,
      widthPx: 110,
    });
  });

  it('cuts where the text stops fitting, leaving room for the ellipsis', () => {
    // 10 px a character, budget 100, ellipsis 20: at most 8 characters, then the ellipsis
    const r = cutToBudget(measure('abcdefghijklmnopqrstuvwxyz'), 100, 20);
    expect(r.truncated).toBe(true);
    expect(r.shown).toBe('abcdefgh…');
  });

  it('ends on a whole word when one ends near the cut', () => {
    const r = cutToBudget(measure('Buy the best red shoes online today'), 200, 20);
    expect(r.shown.endsWith('…')).toBe(true);
    expect(r.shown).toBe('Buy the best red…');
  });

  it('drops trailing punctuation before the ellipsis, and never splits an emoji', () => {
    expect(cutToBudget(measure('Shoes, boots, and more shoes here'), 150, 20).shown).toBe(
      'Shoes, boots…'
    );
    const r = cutToBudget(measure('😀😀😀😀😀😀😀😀😀😀'), 60, 20);
    expect(r.shown).toBe('😀😀😀😀…');
  });

  it('backs up to the previous word rather than cut a long word in half', () => {
    expect(cutToBudget(measure('Shoes, boots, and more shoes here'), 130, 20).shown).toBe('Shoes…');
  });

  it('is empty for no text, and honest when widths were not measured', () => {
    expect(cutToBudget(null, 100, 20)).toBeNull();
    expect(cutToBudget({text: '   ', widthPx: 0, prefixWidths: []}, 100, 20)).toBeNull();
    expect(cutToBudget({text: 'x'.repeat(30), widthPx: 300}, 100, 20)).toEqual({
      shown: 'x'.repeat(30),
      truncated: true,
      widthPx: 300,
    });
    expect(cutToBudget({text: 'fits', widthPx: 40}, 100, 20).truncated).toBe(false);
  });

  it('bounds a huge text', () => {
    const r = cutToBudget(measure('w'.repeat(5000), 1), 100000, 1);
    expect(Array.from(r.shown).length).toBeLessThanOrEqual(401);
    expect(r.truncated).toBe(true);
  });
});

describe('buildSerpPreview', () => {
  const title = measure('A '.repeat(40).trim(), 12);
  const description = measure('word '.repeat(60).trim(), 6);

  it('cuts the title and description separately for desktop and mobile', () => {
    const p = buildSerpPreview({
      url: 'https://example.com/blog/post-one?utm=1',
      title,
      description,
      budgets: BUDGETS,
      fonts: FONTS,
    });
    expect(p.version).toBe(1);
    expect(p.displayUrl).toBe('example.com › blog › post-one');
    expect(p.devices.desktop.title.truncated).toBe(true);
    // the mobile title budget is narrower than the desktop one
    expect(p.devices.mobile.title.shown.length).toBeLessThanOrEqual(
      p.devices.desktop.title.shown.length
    );
    expect(p.devices.desktop.description.shown.length).toBeGreaterThan(
      p.devices.mobile.description.shown.length
    );
  });

  it('shows no title or description that the page does not have', () => {
    const p = buildSerpPreview({url: 'https://example.com/', budgets: BUDGETS, fonts: FONTS});
    expect(p.devices.desktop).toEqual({title: null, description: null});
    expect(p.displayUrl).toBe('example.com');
  });

  it('keeps hostile text as plain strings', () => {
    const p = buildSerpPreview({
      url: 'https://example.com/<script>alert(1)</script>',
      title: measure('<img src=x onerror=alert(1)>', 5),
      budgets: BUDGETS,
      fonts: FONTS,
    });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    expect(typeof p.devices.desktop.title.shown).toBe('string');
  });
});

describe('displayUrlOf and fontSizePx', () => {
  it('shows host and at most two path parts, decoded and clipped', () => {
    expect(displayUrlOf('https://example.com/a/b/c/d')).toBe('example.com › a › b');
    expect(displayUrlOf('https://example.com/caf%C3%A9')).toBe('example.com › café');
    expect(displayUrlOf('https://example.com/%E0%A4%A')).toContain('example.com');
    expect(displayUrlOf('not a url')).toBe('not a url');
    expect(displayUrlOf('https://example.com/' + 'x'.repeat(100))).toBe(
      `example.com › ${'x'.repeat(30)}`
    );
  });

  it('reads the pixel size of a font, with a fallback', () => {
    expect(fontSizePx('400 20px Arial, sans-serif')).toBe(20);
    expect(fontSizePx('bold 13.5px serif')).toBe(13.5);
    expect(fontSizePx('serif')).toBe(16);
  });
});

describe('compareSerpPreviews and reviveSerpPreview', () => {
  const make = (t, d, url = 'https://example.com/') =>
    buildSerpPreview({
      url,
      title: measure(t, 5),
      description: measure(d, 5),
      budgets: BUDGETS,
      fonts: FONTS,
    });

  it('says which parts of the snippet changed', () => {
    const a = make('Title', 'Description');
    expect(compareSerpPreviews(a, make('Title', 'Description'))).toEqual({
      titleChanged: false,
      descriptionChanged: false,
      urlChanged: false,
    });
    expect(
      compareSerpPreviews(a, make('New title', 'Description', 'https://example.com/x'))
    ).toEqual({
      titleChanged: true,
      descriptionChanged: false,
      urlChanged: true,
    });
  });

  it('is null without two previews', () => {
    expect(compareSerpPreviews(null, make('a', 'b'))).toBeNull();
    expect(compareSerpPreviews(make('a', 'b'), undefined)).toBeNull();
  });

  it('accepts a stored preview and refuses anything else', () => {
    const p = make('a', 'b');
    expect(reviveSerpPreview(JSON.parse(JSON.stringify(p)))).toEqual(p);
    for (const bad of [
      null,
      'x',
      {},
      {version: 2},
      {version: 1, displayUrl: 'x', devices: {}},
      {...p, devices: {desktop: {title: {shown: 1}}, mobile: p.devices.mobile}},
    ]) {
      expect(reviveSerpPreview(bad)).toBeNull();
    }
  });
});
