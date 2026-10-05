/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  default: HreflangData,
  collectHreflangData,
  limitFrom,
  LIMIT_ENV,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('../../src/gatherers/hreflang-data.js');

const page = (/** @type {any} */ over = {}) => ({
  pageUrl: 'https://example.com/en/',
  canonical: 'https://example.com/en/',
  htmlLang: 'en',
  contentLanguage: null,
  ogLocale: 'en_US',
  alternates: [{hreflang: 'fr', href: 'https://example.com/fr/'}],
  ...over,
});

describe('limitFrom', () => {
  it('defaults to 10, caps at 25, allows 0, and ignores junk', () => {
    expect(limitFrom(undefined)).toBe(DEFAULT_LIMIT);
    expect(limitFrom('')).toBe(DEFAULT_LIMIT);
    expect(limitFrom('3')).toBe(3);
    expect(limitFrom('0')).toBe(0);
    expect(limitFrom('99')).toBe(MAX_LIMIT);
    expect(limitFrom('-1')).toBe(DEFAULT_LIMIT);
    expect(limitFrom('abc')).toBe(DEFAULT_LIMIT);
    expect(limitFrom('1.5')).toBe(DEFAULT_LIMIT);
  });
});

describe('collectHreflangData', () => {
  it('makes no request for a page without hreflang links', async () => {
    const check = jest.fn();
    const result = await collectHreflangData(page({alternates: []}), {env: {}, check});
    expect(check).not.toHaveBeenCalled();
    expect(result.checks).toMatchObject({state: 'none', results: []});
    expect(result).toMatchObject({
      htmlLang: 'en',
      ogLocale: 'en_US',
      canonical: 'https://example.com/en/',
    });
  });

  it('checks the alternates with the configured limit', async () => {
    const check = jest.fn(async () => ({
      results: [{url: 'https://example.com/fr/'}],
      notChecked: 2,
    }));
    // @ts-expect-error - partial check results
    const result = await collectHreflangData(page(), {env: {[LIMIT_ENV]: '4'}, check});
    expect(check).toHaveBeenCalledWith({
      pageUrl: 'https://example.com/en/',
      alternates: page().alternates,
      limit: 4,
    });
    expect(result.checks).toMatchObject({state: 'checked', notChecked: 2, reason: null});
    expect(result.checks.results).toHaveLength(1);
  });

  it('uses the default limit when the variable is unset, and makes no request when it is 0', async () => {
    const check = jest.fn(async () => ({results: [], notChecked: 0}));
    await collectHreflangData(page(), {env: {}, check});
    expect(check.mock.calls[0][0].limit).toBe(10);
    check.mockClear();
    const off = await collectHreflangData(page(), {env: {[LIMIT_ENV]: '0'}, check});
    expect(check).not.toHaveBeenCalled();
    expect(off.checks.state).toBe('disabled');
    expect(off.checks.reason).toContain(LIMIT_ENV);
  });

  it('tolerates a malformed alternates field', async () => {
    // @ts-expect-error - deliberately wrong input
    const result = await collectHreflangData(page({alternates: null}), {env: {}, check: jest.fn()});
    expect(result.alternates).toEqual([]);
    expect(result.checks.state).toBe('none');
  });
});

describe('HreflangData gatherer class', () => {
  it('evaluates in the isolated context and collects the checks', async () => {
    const evaluate = jest.fn(() => Promise.resolve(page({alternates: []})));
    // @ts-expect-error - partial pass context
    const artifact = await new HreflangData().getArtifact({driver: {executionContext: {evaluate}}});
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({useIsolation: true})
    );
    expect(artifact.checks.state).toBe('none');
  });
});
