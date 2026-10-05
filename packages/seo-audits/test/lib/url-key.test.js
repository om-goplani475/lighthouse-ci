/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {looseKey} = require('../../src/lib/url-key.js');

describe('looseKey', () => {
  it('ignores a trailing slash, the fragment and host case; keeps path case and query', () => {
    expect(looseKey('https://Example.com/en/')).toBe('https://example.com/en');
    expect(looseKey('https://example.com/en#top')).toBe('https://example.com/en');
    expect(looseKey('https://example.com/EN')).not.toBe(looseKey('https://example.com/en'));
    expect(looseKey('https://example.com/a?x=1')).toBe('https://example.com/a?x=1');
    expect(looseKey('https://example.com/')).toBe('https://example.com/');
  });
  it('resolves against a base and rejects non-http(s) and junk', () => {
    expect(looseKey('/fr/', 'https://example.com/en/')).toBe('https://example.com/fr');
    expect(looseKey('ftp://example.com/')).toBeNull();
    expect(looseKey('mailto:a@b.c')).toBeNull();
    expect(looseKey('')).toBeNull();
    expect(looseKey(null)).toBeNull();
    expect(looseKey('not a url')).toBeNull();
  });
  it('stays linear on a very long run of slashes', () => {
    const start = Date.now();
    looseKey(`https://example.com/a${'/'.repeat(200000)}`);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
