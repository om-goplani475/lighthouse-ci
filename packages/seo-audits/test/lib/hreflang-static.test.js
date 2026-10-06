/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildCodesProduct,
  buildXDefaultProduct,
  buildLocaleMetaProduct,
  primaryOf,
  regionOf,
} = require('../../src/lib/hreflang-static.js');
const {gate, selfEntries, MAX_ROWS} = require('../../src/lib/hreflang-common.js');

const EN = 'https://example.com/en/';
const good = [
  {hreflang: 'en', href: EN},
  {hreflang: 'fr', href: 'https://example.com/fr/'},
  {hreflang: 'x-default', href: 'https://example.com/'},
];
const data = (/** @type {any} */ over = {}) => ({
  pageUrl: EN,
  canonical: EN,
  htmlLang: 'en',
  contentLanguage: null,
  ogLocale: null,
  alternates: good,
  checks: {state: 'none', reason: null, results: [], notChecked: 0},
  ...over,
});

describe('gate and selfEntries', () => {
  it('is not applicable without data or without hreflang links', () => {
    expect(gate(null)).toMatchObject({notApplicable: true});
    expect(gate(data({alternates: []}))).toMatchObject({
      notApplicable: true,
      explanation: 'The page declares no hreflang links.',
    });
    expect(gate(data({alternates: null}))).toMatchObject({notApplicable: true});
    expect(gate(data())).toBeNull();
  });
  it('finds the page itself by URL or canonical, ignoring a trailing slash', () => {
    expect(selfEntries(data({pageUrl: 'https://example.com/en'}))).toHaveLength(1);
    expect(
      selfEntries(data({pageUrl: 'https://example.com/en/?utm=x', canonical: EN}))
    ).toHaveLength(1);
    expect(
      selfEntries(data({pageUrl: 'https://example.com/other/', canonical: null}))
    ).toHaveLength(0);
  });
});

describe('buildCodesProduct', () => {
  it('passes valid codes with a self reference', () => {
    const p = buildCodesProduct(data());
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('3 hreflang values are valid and the page lists itself');
  });

  it('fails an invalid code and gives the fix', () => {
    const p = buildCodesProduct(
      data({alternates: [...good, {hreflang: 'en-UK', href: 'https://example.com/uk/'}]})
    );
    expect(p.score).toBe(0);
    expect(p.details.items[0]).toMatchObject({value: 'en-UK', fix: 'use "en-gb"'});
  });

  it('fails a page that does not list itself', () => {
    const p = buildCodesProduct(data({alternates: [good[1], good[2]]}));
    expect(p.score).toBe(0);
    expect(p.details.items[0].value).toBe('(this page)');
  });

  it('fails one value pointing at two URLs, but not two values pointing at one URL', () => {
    const clash = buildCodesProduct(
      data({alternates: [...good, {hreflang: 'FR', href: 'https://example.com/fr-2/'}]})
    );
    expect(clash.details.items[0].problem).toMatch(/2 different URLs/);
    const same = buildCodesProduct(
      data({alternates: [...good, {hreflang: 'fr-CA', href: 'https://example.com/fr/'}]})
    );
    expect(same.score).toBe(1);
  });

  it('caps the table rows', () => {
    const bad = Array.from({length: MAX_ROWS + 5}, (_, i) => ({
      hreflang: `e_${i}`,
      href: `https://example.com/${i}/`,
    }));
    const p = buildCodesProduct(data({alternates: [good[0], ...bad]}));
    expect(p.details.items).toHaveLength(MAX_ROWS + 1);
  });
});

describe('buildXDefaultProduct (informational)', () => {
  it('reports a present x-default and a missing one without failing', () => {
    expect(buildXDefaultProduct(data()).displayValue).toBe('x-default present');
    const missing = buildXDefaultProduct(data({alternates: [good[0], good[1]]}));
    expect(missing.score).toBe(1);
    expect(missing.displayValue).toBe('No x-default (optional)');
  });
  it('notes more than one x-default URL', () => {
    const p = buildXDefaultProduct(
      data({alternates: [...good, {hreflang: 'x-default', href: 'https://example.com/choose/'}]})
    );
    expect(p.displayValue).toBe('2 different x-default URLs');
    expect(buildXDefaultProduct(data({alternates: []})).notApplicable).toBe(true);
  });
});

describe('buildLocaleMetaProduct (informational)', () => {
  it('matches lang, content-language and og:locale to the page hreflang', () => {
    const p = buildLocaleMetaProduct(
      data({htmlLang: 'en-GB', contentLanguage: 'en', ogLocale: 'en_US'})
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('3 of 3 locale signals match the hreflang (en)');
  });
  it('notes a different language or region', () => {
    const p = buildLocaleMetaProduct(
      data({
        alternates: [{hreflang: 'en-GB', href: EN}, good[1]],
        htmlLang: 'fr',
        ogLocale: 'en_US',
      })
    );
    expect(p.displayValue).toBe('0 of 2 locale signals match the hreflang (en-GB)');
    expect(p.details.items.map((/** @type {any} */ i) => i.result)).toEqual([
      'a different language from the hreflang (en-GB)',
      'a different region from the hreflang (en-GB)',
    ]);
  });
  it('is not applicable when the page does not list itself or its entry is invalid, and says so when there is nothing to compare', () => {
    expect(buildLocaleMetaProduct(data({alternates: [good[1]]})).notApplicable).toBe(true);
    expect(
      buildLocaleMetaProduct(data({alternates: [{hreflang: 'en_UK', href: EN}]})).notApplicable
    ).toBe(true);
    expect(buildLocaleMetaProduct(data({htmlLang: null})).displayValue).toMatch(/No lang/);
  });
  it('reads primary languages and regions leniently', () => {
    expect(primaryOf('en_US')).toBe('en');
    expect(primaryOf('')).toBeNull();
    expect(primaryOf(null)).toBeNull();
    expect(regionOf('en_us')).toBe('US');
    expect(regionOf('en')).toBeNull();
  });
});

describe('the page URL with tracking parameters', () => {
  it('still lists itself when it carries utm parameters and has no canonical', () => {
    const d = data({pageUrl: 'https://example.com/en/?utm_source=x&gclid=1', canonical: null});
    expect(selfEntries(d)).toHaveLength(1);
    expect(buildCodesProduct(d).score).toBe(1);
  });

  it('keeps a real query parameter significant', () => {
    const d = data({pageUrl: 'https://example.com/en/?page=2', canonical: null});
    expect(buildCodesProduct(d).score).toBe(0);
  });
});
