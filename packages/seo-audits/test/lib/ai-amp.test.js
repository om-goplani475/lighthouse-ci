/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildAmpProduct} = require('../../src/lib/ai-amp.js');
const {collectAmpPage, SWITCH_ENV} = require('../../src/gatherers/amp-page.js');

const PAGE = 'https://example.com/story';
const AMP = 'https://example.com/story/amp';
const check = (/** @type {any} */ over = {}) => ({
  url: AMP,
  hreflang: 'amp',
  sameOrigin: true,
  status: 200,
  redirectLocation: null,
  error: null,
  bodyRead: 'html',
  truncated: false,
  noindex: false,
  canonicals: [PAGE],
  alternates: [],
  hasHreflang: false,
  ...over,
});
const data = (/** @type {any} */ over = {}) => ({
  pageUrl: PAGE,
  isAmp: false,
  canonical: PAGE,
  ampUrl: AMP,
  state: 'checked',
  reason: null,
  check: check(),
  ...over,
});
const rows = (/** @type {any} */ p) =>
  Object.fromEntries(p.details.items.map((/** @type {any} */ i) => [i.item, i.result]));

describe('buildAmpProduct (informational)', () => {
  it('reports an AMP version that loads and names this page as canonical', () => {
    const p = buildAmpProduct(data());
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('This page links to an AMP version');
    expect(rows(p)['AMP version loads']).toBe('answers 200');
    expect(rows(p)['AMP version names this page as its canonical']).toBe('yes');
  });
  it('reports problems with the AMP version without failing', () => {
    expect(
      rows(buildAmpProduct(data({check: check({status: 404, bodyRead: 'skipped-status'})})))[
        'AMP version loads'
      ]
    ).toBe('answers 404');
    expect(
      rows(
        buildAmpProduct(
          data({check: check({status: 301, redirectLocation: '/new', bodyRead: 'skipped-status'})})
        )
      )['AMP version loads']
    ).toBe('redirects to /new');
    expect(
      rows(buildAmpProduct(data({check: check({status: null, error: 'ENOTFOUND'})})))[
        'AMP version loads'
      ]
    ).toBe('no answer (ENOTFOUND)');
    expect(rows(buildAmpProduct(data({check: check({noindex: true})})))['AMP version loads']).toBe(
      'answers 200, but is noindex'
    );
    expect(
      rows(buildAmpProduct(data({check: check({canonicals: ['https://other.example/']})})))[
        'AMP version names this page as its canonical'
      ]
    ).toMatch(/^no \(it names https:\/\/other\.example/);
    expect(
      rows(buildAmpProduct(data({check: check({canonicals: []})})))[
        'AMP version names this page as its canonical'
      ]
    ).toBe('declares no canonical');
  });
  it('describes a page that is itself AMP, with and without a canonical', () => {
    const p = buildAmpProduct(data({isAmp: true, ampUrl: null, check: null}));
    expect(p.displayValue).toBe('This page is an AMP page');
    expect(rows(p)['Its canonical']).toBe(PAGE);
    expect(
      rows(buildAmpProduct(data({isAmp: true, ampUrl: null, canonical: null})))['Its canonical']
    ).toMatch(/^missing/);
  });
  it('says the request was switched off', () => {
    const p = buildAmpProduct(data({state: 'disabled', reason: 'switched off (X=0)', check: null}));
    expect(rows(p)['AMP version loads']).toBe('switched off (X=0)');
  });
  it('is not applicable without AMP or data, and always ends with the note', () => {
    expect(buildAmpProduct(data({ampUrl: null, check: null})).notApplicable).toBe(true);
    expect(buildAmpProduct(null).notApplicable).toBe(true);
    expect(buildAmpProduct({}).notApplicable).toBe(true);
    const items = buildAmpProduct(data()).details.items;
    expect(items[items.length - 1].result).toMatch(/no longer required/);
  });
});

describe('collectAmpPage', () => {
  const page = {pageUrl: PAGE, isAmp: false, canonical: PAGE, ampUrl: AMP};
  it('makes no request without an AMP link', async () => {
    const checkFn = jest.fn();
    const result = await collectAmpPage({...page, ampUrl: null}, {env: {}, check: checkFn});
    expect(checkFn).not.toHaveBeenCalled();
    expect(result.state).toBe('none');
  });
  it('requests the AMP version once, and not when switched off', async () => {
    const checkFn = jest.fn(async () => ({results: [check()], notChecked: 0}));
    const result = await collectAmpPage(page, {env: {}, check: checkFn});
    expect(checkFn).toHaveBeenCalledWith({
      pageUrl: PAGE,
      alternates: [{hreflang: 'amp', href: AMP}],
      limit: 1,
    });
    expect(result).toMatchObject({state: 'checked', check: {status: 200}});
    checkFn.mockClear();
    const off = await collectAmpPage(page, {env: {[SWITCH_ENV]: '0'}, check: checkFn});
    expect(checkFn).not.toHaveBeenCalled();
    expect(off).toMatchObject({state: 'disabled', check: null});
    expect(off.reason).toContain(SWITCH_ENV);
  });
  it('tolerates an empty result', async () => {
    const result = await collectAmpPage(page, {
      env: {},
      check: async () => ({results: [], notChecked: 0}),
    });
    expect(result).toMatchObject({state: 'checked', check: null});
  });
});
