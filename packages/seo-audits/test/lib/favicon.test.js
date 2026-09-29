/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  faviconLinks,
  manifestLink,
  largestDimension,
  isScalable,
  manifestIconSize,
  buildManifestIconsResult,
} = require('../../src/lib/favicon.js');

describe('faviconLinks', () => {
  it('keeps only icon/shortcut icon links with an href', () => {
    const links = [
      {rel: 'icon', href: 'https://example.com/icon.png', sizes: null, type: null},
      {rel: 'shortcut icon', href: 'https://example.com/favicon.ico', sizes: null, type: null},
      {rel: 'manifest', href: 'https://example.com/manifest.json', sizes: null, type: null},
      {rel: 'icon', href: null, sizes: null, type: null},
    ];
    expect(faviconLinks(links)).toHaveLength(2);
  });
});

describe('manifestLink', () => {
  it('finds the manifest link with an href', () => {
    const links = [
      {rel: 'icon', href: 'https://example.com/icon.png', sizes: null, type: null},
      {rel: 'manifest', href: 'https://example.com/manifest.json', sizes: null, type: null},
    ];
    expect(manifestLink(links).href).toBe('https://example.com/manifest.json');
  });

  it('returns undefined when there is no manifest link', () => {
    expect(manifestLink([{rel: 'icon', href: 'x', sizes: null, type: null}])).toBeUndefined();
  });
});

describe('largestDimension', () => {
  it('parses a single "WxH" token', () => {
    expect(largestDimension('32x32')).toBe(32);
  });

  it('takes the largest across multiple space-separated tokens', () => {
    expect(largestDimension('16x16 32x32 192x192')).toBe(192);
  });

  it('returns 0 for null/empty/unparseable input', () => {
    expect(largestDimension(null)).toBe(0);
    expect(largestDimension('')).toBe(0);
    expect(largestDimension('any')).toBe(0);
  });
});

describe('isScalable', () => {
  it('is true for an SVG type', () => {
    expect(isScalable({rel: 'icon', href: 'x', sizes: null, type: 'image/svg+xml'})).toBe(true);
  });

  it('is true for sizes="any"', () => {
    expect(isScalable({rel: 'icon', href: 'x', sizes: 'any', type: null})).toBe(true);
  });

  it('is false for an ordinary sized PNG', () => {
    expect(isScalable({rel: 'icon', href: 'x', sizes: '32x32', type: 'image/png'})).toBe(false);
  });
});

describe('manifestIconSize', () => {
  it('parses the sizes string', () => {
    expect(manifestIconSize({sizes: '192x192'})).toBe(192);
  });

  it('treats sizes: "any" as always-adequate (Infinity)', () => {
    expect(manifestIconSize({sizes: 'any'})).toBe(Infinity);
  });

  it('returns 0 when sizes is missing', () => {
    expect(manifestIconSize({})).toBe(0);
  });
});

describe('buildManifestIconsResult', () => {
  it('scores 0 when given a fetch/parse error', () => {
    const result = buildManifestIconsResult(new Error('fetch of "x" returned HTTP 404'));
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('Could not fetch or parse');
    expect(result.explanation).toContain('HTTP 404');
  });

  it('scores 0 when the manifest has no icons array', () => {
    expect(buildManifestIconsResult({}).score).toBe(0);
    expect(buildManifestIconsResult({icons: []}).score).toBe(0);
  });

  it('scores 0 when no icon meets the minimum installable size', () => {
    const result = buildManifestIconsResult({icons: [{src: 'x.png', sizes: '48x48'}]});
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('192x192');
  });

  it('scores 1 when at least one icon meets the minimum installable size', () => {
    const result = buildManifestIconsResult({
      icons: [
        {src: 'small.png', sizes: '48x48'},
        {src: 'big.png', sizes: '512x512'},
      ],
    });
    expect(result.score).toBe(1);
  });

  it('scores 1 for a scalable ("any") icon', () => {
    const result = buildManifestIconsResult({icons: [{src: 'x.svg', sizes: 'any'}]});
    expect(result.score).toBe(1);
  });
});
