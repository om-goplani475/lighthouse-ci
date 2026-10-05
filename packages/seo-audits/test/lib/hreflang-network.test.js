/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildReturnLinksProduct,
  buildAlternateStatusProduct,
  buildCanonicalProduct,
} = require('../../src/lib/hreflang-network.js');

const EN = 'https://example.com/en/';
const FR = 'https://example.com/fr/';
const check = (/** @type {any} */ over = {}) => ({
  url: FR,
  hreflang: 'fr',
  sameOrigin: true,
  status: 200,
  redirectLocation: null,
  error: null,
  bodyRead: 'html',
  truncated: false,
  noindex: false,
  canonicals: [FR],
  alternates: [
    {hreflang: 'en', href: EN},
    {hreflang: 'fr', href: FR},
  ],
  hasHreflang: true,
  ...over,
});
const data = (/** @type {any[]} */ results, /** @type {any} */ over = {}) => ({
  pageUrl: EN,
  canonical: EN,
  htmlLang: 'en',
  contentLanguage: null,
  ogLocale: null,
  alternates: [
    {hreflang: 'en', href: EN},
    {hreflang: 'fr', href: FR},
  ],
  checks: {state: 'checked', reason: null, results, notChecked: 0},
  ...over,
});

describe('not applicable gates', () => {
  it.each([buildReturnLinksProduct, buildAlternateStatusProduct])(
    '%p needs hreflang links and requested alternates',
    build => {
      expect(build(null).notApplicable).toBe(true);
      expect(build(data([], {alternates: []})).explanation).toBe(
        'The page declares no hreflang links.'
      );
      expect(
        build(
          data([], {
            checks: {state: 'disabled', reason: 'switched off (X=0)', results: [], notChecked: 0},
          })
        ).explanation
      ).toBe('switched off (X=0)');
      expect(
        build(data([], {checks: {state: 'none', reason: null, results: [], notChecked: 0}}))
          .notApplicable
      ).toBe(true);
      expect(build(data([])).notApplicable).toBe(true);
    }
  );
});

describe('buildReturnLinksProduct', () => {
  it('passes when the alternate links back, even with a trailing-slash difference', () => {
    const p = buildReturnLinksProduct(
      data([check({alternates: [{hreflang: 'en', href: 'https://example.com/en'}]})])
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('1 of 1 judged alternates link back');
  });

  it('accepts a link back to the page canonical', () => {
    const p = buildReturnLinksProduct(
      data([check({alternates: [{hreflang: 'en', href: EN}]})], {
        pageUrl: 'https://example.com/en/?utm=x',
      })
    );
    expect(p.score).toBe(1);
  });

  it('fails an alternate that has hreflang tags but none naming this page', () => {
    const p = buildReturnLinksProduct(
      data([check({alternates: [{hreflang: 'de', href: 'https://example.com/de/'}]})])
    );
    expect(p.score).toBe(0);
    expect(p.details.items[0]).toMatchObject({
      hreflang: 'fr',
      result: 'does not link back to this page',
    });
  });

  it('only notes an alternate with no hreflang tags in its HTML', () => {
    const p = buildReturnLinksProduct(data([check({alternates: [], hasHreflang: false})]));
    expect(p.score).toBe(1);
    expect(p.details.items[0].result).toMatch(/^note: no hreflang links in its HTML/);
  });

  it('skips unreadable alternates, and is not applicable when none could be read', () => {
    const bad = check({status: 404, bodyRead: 'skipped-status'});
    expect(buildReturnLinksProduct(data([bad])).notApplicable).toBe(true);
    expect(buildReturnLinksProduct(data([bad, check()])).score).toBe(1);
  });

  it('mentions alternates that were not requested', () => {
    const p = buildReturnLinksProduct(
      data([check()], {checks: {state: 'checked', reason: null, results: [check()], notChecked: 3}})
    );
    expect(p.displayValue).toMatch(/3 more not requested/);
  });
});

describe('buildAlternateStatusProduct', () => {
  const run = (/** @type {any} */ over) => buildAlternateStatusProduct(data([check(over)]));

  it('passes a normal 200', () => {
    expect(run({}).displayValue).toBe('1 alternates answer normally');
  });

  it.each([
    [{status: 404}, /answers 404/],
    [{status: 410}, /answers 410/],
    [{status: 301, redirectLocation: '/new'}, /redirects to \/new/],
    [{status: 302, redirectLocation: null}, /redirects;/],
    [{status: 200, noindex: true}, /is noindex/],
    [{status: null, error: 'ENOTFOUND'}, /host does not exist/],
    [{status: null, error: 'ECONNREFUSED'}, /connection was refused/],
  ])('fails %j', (over, pattern) => {
    const p = run(over);
    expect(p.score).toBe(0);
    expect(p.details.items[0].result).toMatch(pattern);
  });

  it.each([
    [{status: 403}, /bot protection/],
    [{status: 429}, /bot protection/],
    [{status: 500}, /may be temporary/],
    [{status: 503}, /may be temporary/],
    [{status: null, error: 'TIMEOUT'}, /could not be checked/],
    [{status: null, error: 'TLS'}, /could not be checked/],
    [{status: null, error: 'PRIVATE'}, /private address/],
  ])('only notes %j', (over, pattern) => {
    const p = run(over);
    expect(p.score).toBe(1);
    expect(p.details.items[0].result).toMatch(pattern);
  });

  it('counts the failures among all alternates', () => {
    const p = buildAlternateStatusProduct(
      data([check(), check({status: 404, url: 'https://example.com/de/', hreflang: 'de'})])
    );
    expect(p.displayValue).toBe('1 of 2 alternate has a problem');
  });
});

describe('buildCanonicalProduct', () => {
  it('passes when canonicals agree with the hreflang URLs', () => {
    expect(buildCanonicalProduct(data([check()])).score).toBe(1);
  });

  it('fails a page whose canonical is another language version', () => {
    const p = buildCanonicalProduct(
      data([], {canonical: FR, checks: {state: 'none', reason: null, results: [], notChecked: 0}})
    );
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toMatch(/its canonical is the fr version/);
  });

  it('does not fail a canonical that differs for another reason', () => {
    expect(
      buildCanonicalProduct(data([], {canonical: 'https://example.com/en/?ref=1'})).score
    ).toBe(1);
  });

  it('fails an alternate whose canonical is not the URL hreflang names', () => {
    const p = buildCanonicalProduct(data([check({canonicals: ['https://example.com/en/']})]));
    expect(p.score).toBe(0);
    expect(p.details.items[0].page).toBe(FR);
  });

  it('ignores alternates with several canonicals, none, or an unreadable answer', () => {
    expect(
      buildCanonicalProduct(
        data([
          check({canonicals: [EN, FR]}),
          check({canonicals: []}),
          check({status: 404, bodyRead: 'skipped-status'}),
        ])
      ).score
    ).toBe(1);
  });

  it('is not applicable with nothing to compare', () => {
    expect(
      buildCanonicalProduct(
        data([], {
          canonical: null,
          checks: {state: 'none', reason: null, results: [], notChecked: 0},
        })
      ).notApplicable
    ).toBe(true);
    expect(buildCanonicalProduct(data([], {alternates: []})).notApplicable).toBe(true);
  });
});
