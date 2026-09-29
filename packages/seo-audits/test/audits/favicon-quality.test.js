/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: FaviconQuality} = require('../../src/audits/favicon-quality.js');

function runAudit(faviconLinks) {
  return FaviconQuality.audit({FaviconLinks: faviconLinks});
}

describe('favicon-quality audit', () => {
  it('is notApplicable when there is no favicon at all', () => {
    const result = runAudit([]);
    expect(result.notApplicable).toBe(true);
  });

  it('flags single-size-only and missing apple-touch-icon together', () => {
    const result = runAudit([
      {rel: 'icon', href: 'https://example.com/icon.png', sizes: '32x32', type: 'image/png'},
    ]);
    expect(result.score).toBeNull();
    const aspects = result.details.items.map(row => row.aspect).sort();
    expect(aspects).toEqual(['No apple-touch-icon', 'Single size only']);
  });

  it('does not flag single-size when the icon is a scalable SVG', () => {
    const result = runAudit([
      {rel: 'icon', href: 'https://example.com/icon.svg', sizes: null, type: 'image/svg+xml'},
      {
        rel: 'apple-touch-icon',
        href: 'https://example.com/apple.png',
        sizes: '180x180',
        type: null,
      },
    ]);
    expect(result.score).toBeNull();
    expect(result.details).toBeUndefined();
  });

  it('does not flag single-size when multiple distinct sizes are declared', () => {
    const result = runAudit([
      {rel: 'icon', href: 'https://example.com/16.png', sizes: '16x16', type: 'image/png'},
      {rel: 'icon', href: 'https://example.com/32.png', sizes: '32x32', type: 'image/png'},
      {
        rel: 'apple-touch-icon',
        href: 'https://example.com/apple.png',
        sizes: '180x180',
        type: null,
      },
    ]);
    expect(result.details).toBeUndefined();
  });

  it('flags missing apple-touch-icon even when favicon coverage is otherwise good', () => {
    const result = runAudit([
      {rel: 'icon', href: 'https://example.com/icon.svg', sizes: null, type: 'image/svg+xml'},
    ]);
    expect(result.details.items).toEqual([
      expect.objectContaining({aspect: 'No apple-touch-icon'}),
    ]);
  });

  it('is scoreDisplayMode informative', () => {
    expect(FaviconQuality.meta.scoreDisplayMode).toBe('informative');
  });
});
