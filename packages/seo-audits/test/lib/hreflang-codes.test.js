/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {parseHreflang, isKnownLanguage, isKnownRegion} = require('../../src/lib/hreflang-codes.js');

const ok = (/** @type {string} */ v) => parseHreflang(v);

describe('parseHreflang: valid values', () => {
  it.each([
    'en',
    'EN',
    'en-GB',
    'en-gb',
    'fr-CA',
    'pt-BR',
    'zh-Hans',
    'zh-Hant-TW',
    'es-419',
    'x-default',
    'X-Default',
    'de-AT',
    'ja',
  ])('accepts %s', value => {
    const parsed = ok(value);
    expect(parsed.valid).toBe(true);
    expect(parsed.problem).toBeNull();
  });

  it('breaks a value into its parts', () => {
    expect(ok('zh-Hant-TW')).toMatchObject({
      kind: 'language',
      language: 'zh',
      script: 'hant',
      region: 'tw',
    });
    expect(ok('es-419')).toMatchObject({language: 'es', script: null, region: '419'});
    expect(ok('x-default')).toMatchObject({kind: 'x-default', language: null});
    expect(ok(' en-US ').raw).toBe('en-US');
  });

  it('accepts the retired language codes', () => {
    expect(ok('iw').valid).toBe(true);
    expect(ok('in-ID').valid).toBe(true);
  });
});

describe('parseHreflang: invalid values and suggestions', () => {
  it('refuses UK with GB', () => {
    const p = ok('en-UK');
    expect(p.valid).toBe(false);
    expect(p.problem).toMatch(/United Kingdom is GB/);
    expect(p.suggestion).toBe('en-gb');
  });

  it('refuses an underscore with the hyphen form', () => {
    expect(ok('en_US')).toMatchObject({valid: false, suggestion: 'en-US'});
  });

  it('refuses a three-letter language and suggests the two-letter one when it knows it', () => {
    expect(ok('eng')).toMatchObject({valid: false, suggestion: 'en'});
    expect(ok('fra-CA')).toMatchObject({valid: false, suggestion: 'fr-ca'});
    expect(ok('xyz').suggestion).toBeNull();
    expect(ok('eng').problem).toMatch(/two-letter language code/);
  });

  it('refuses a bare country code and tells the author to put the language first', () => {
    const p = ok('GB');
    expect(p.valid).toBe(false);
    expect(p.problem).toMatch(/looks like a country code/);
    expect(p.problem).toMatch(/en-GB/);
  });

  it('refuses an unknown language or region', () => {
    expect(ok('xx').problem).toMatch(/"xx" is not a language code/);
    expect(ok('en-ZZ').problem).toMatch(/"ZZ" is not a country or region code/);
  });

  it('refuses malformed shapes and empty or non-string values', () => {
    expect(ok('en-GB-extra-more').valid).toBe(false);
    expect(ok('en--GB').valid).toBe(false);
    expect(ok('en-G').valid).toBe(false);
    expect(ok('').problem).toMatch(/empty/);
    expect(parseHreflang(undefined).valid).toBe(false);
    expect(parseHreflang(42).valid).toBe(false);
    expect(ok('en GB').valid).toBe(false);
    expect(ok('1234').valid).toBe(false);
  });
});

describe('isKnownLanguage and isKnownRegion', () => {
  it('uses the runtime locale data', () => {
    expect(isKnownLanguage('fr')).toBe(true);
    expect(isKnownLanguage('zz')).toBe(false);
    expect(isKnownRegion('GB')).toBe(true);
    expect(isKnownRegion('QQ')).toBe(false);
  });
});
