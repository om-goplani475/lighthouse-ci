/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {parseDirectives, blocksIndexing} = require('../../src/lib/robots-directives.js');

describe('parseDirectives', () => {
  it('parses a simple comma-separated list, case-insensitively, with explanations', () => {
    const directives = parseDirectives('NOINDEX, nofollow');
    expect(directives).toEqual([
      expect.objectContaining({raw: 'NOINDEX', key: 'noindex', explanation: expect.any(String)}),
      expect.objectContaining({raw: 'nofollow', key: 'nofollow', explanation: expect.any(String)}),
    ]);
  });

  it('parses value-bearing directives (max-snippet etc.) and includes the value in the explanation', () => {
    const [directive] = parseDirectives('max-snippet:-1');
    expect(directive.key).toBe('max-snippet');
    expect(directive.value).toBe('-1');
    expect(directive.explanation).toContain('-1');
  });

  it('returns null explanation for an unrecognized token', () => {
    const [directive] = parseDirectives('no-index');
    expect(directive.explanation).toBeNull();
  });

  it('returns an empty array for absent/empty content', () => {
    expect(parseDirectives(undefined)).toEqual([]);
    expect(parseDirectives(null)).toEqual([]);
    expect(parseDirectives('')).toEqual([]);
    expect(parseDirectives('   ')).toEqual([]);
  });
});

describe('blocksIndexing', () => {
  it('is true for noindex', () => {
    expect(blocksIndexing(parseDirectives('noindex'))).toBe(true);
  });

  it('is true for none', () => {
    expect(blocksIndexing(parseDirectives('none'))).toBe(true);
  });

  it('is false for index, follow', () => {
    expect(blocksIndexing(parseDirectives('index, follow'))).toBe(false);
  });

  it('is false for an empty directive list', () => {
    expect(blocksIndexing([])).toBe(false);
  });
});
