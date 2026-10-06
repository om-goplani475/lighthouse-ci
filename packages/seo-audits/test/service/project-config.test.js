/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  PRESETS,
  validateConfig,
  resolveSeverities,
  resolveAssertions,
} = require('../../src/service/project-config.js');
const {CATEGORIES} = require('../../src/summary/categories.js');
const recommended = require('../../src/recommended-assertions.json');

const tierOf = id => recommended[id][0];

describe('project config', () => {
  it('defaults to the recommended preset: every scored audit at its recommended severity', () => {
    const severities = resolveSeverities(undefined, recommended);
    expect(Object.keys(severities).sort()).toEqual(Object.keys(recommended).sort());
    for (const [id, severity] of Object.entries(severities)) expect(severity).toBe(tierOf(id));
    expect(resolveSeverities({}, recommended)).toEqual(severities);
  });

  it('never asserts an informational audit', () => {
    expect(
      resolveSeverities({audits: {'llms-txt-structure': 'error'}}, recommended)[
        'llms-txt-structure'
      ]
    ).toBe(undefined);
  });

  it('seo:strict turns every warn-tier audit into an error', () => {
    const severities = resolveSeverities({preset: 'seo:strict'}, recommended);
    expect(new Set(Object.values(severities))).toEqual(new Set(['error']));
  });

  it('ecommerce promotes only warn-tier audits in its categories, and leaves others alone', () => {
    const base = resolveSeverities({}, recommended);
    const severities = resolveSeverities({preset: 'ecommerce'}, recommended);
    const promoted = new Set(
      CATEGORIES.filter(c => PRESETS.ecommerce.promote.includes(c.name)).flatMap(c => c.audits)
    );
    for (const id of Object.keys(base)) {
      const expected = base[id] === 'warn' && promoted.has(id) ? 'error' : base[id];
      expect(severities[id]).toBe(expected);
    }
  });

  it('internal-portal and minimal switch off everything outside crawlability and robots', () => {
    const inScope = new Set(
      CATEGORIES.filter(c => PRESETS['internal-portal'].only.includes(c.name)).flatMap(
        c => c.audits
      )
    );
    for (const preset of ['internal-portal', 'minimal']) {
      const severities = resolveSeverities({preset}, recommended);
      for (const [id, severity] of Object.entries(severities)) {
        if (!inScope.has(id)) expect(severity).toBe('off');
      }
    }
    expect(
      resolveSeverities({preset: 'internal-portal'}, recommended)['redirect-chain-length']
    ).toBe('warn');
    expect(resolveSeverities({preset: 'minimal'}, recommended)['redirect-chain-length']).toBe(
      'off'
    );
    expect(resolveSeverities({preset: 'minimal'}, recommended)['robots-txt-crawler-access']).toBe(
      'error'
    );
  });

  it('applies overrides in order: preset, then category, then audit', () => {
    const severities = resolveSeverities(
      {
        preset: 'seo:strict',
        categories: {Images: 'warn'},
        audits: {'broken-images': 'off'},
      },
      recommended
    );
    expect(severities['broken-images']).toBe('off');
    expect(severities['image-alt-quality']).toBe('warn');
    expect(severities['canonical-https']).toBe('error');
  });

  it('resolves to an lhci assertions object, with off written as "off"', () => {
    const assertions = resolveAssertions({audits: {'canonical-https': 'off'}}, recommended);
    expect(assertions['canonical-https']).toBe('off');
    expect(assertions['sitemap-valid']).toEqual(['error', {minScore: 1}]);
    expect(assertions['ssl-certificate-expiry']).toEqual(recommended['ssl-certificate-expiry']);
  });

  it('keeps ssl-certificate-expiry partial threshold when its severity changes', () => {
    const assertions = resolveAssertions({audits: {'ssl-certificate-expiry': 'warn'}}, recommended);
    expect(assertions['ssl-certificate-expiry']).toEqual(['warn', {minScore: 0.5}]);
  });

  describe('validation', () => {
    it('accepts missing and empty configs', () => {
      expect(validateConfig(undefined)).toEqual([]);
      expect(validateConfig(null)).toEqual([]);
      expect(validateConfig({})).toEqual([]);
    });

    it('lists every problem at once', () => {
      const problems = validateConfig({
        preset: 'nope',
        categories: {Nonsense: 'error', Images: 'fatal'},
        audits: {'no-such-audit': 'warn'},
      });
      expect(problems).toHaveLength(4);
      expect(problems.join('|')).toMatch(/unknown preset "nope"/);
      expect(problems.join('|')).toMatch(/unknown category "Nonsense"/);
      expect(problems.join('|')).toMatch(/categories.Images: must be one of/);
      expect(problems.join('|')).toMatch(/unknown audit "no-such-audit"/);
    });

    it('rejects wrong shapes and prototype keys', () => {
      expect(validateConfig([])).toEqual(['config must be an object']);
      expect(validateConfig({audits: []})).toEqual(['audits must be an object']);
      expect(validateConfig({preset: 'constructor'}).length).toBe(1);
      expect(validateConfig({audits: {__proto__x: 'off'}}).length).toBeGreaterThan(0);
      expect(validateConfig({categories: {toString: 'off'}}).length).toBeGreaterThan(0);
    });

    it('throws with all problems when resolving an invalid config', () => {
      expect(() => resolveSeverities({preset: 'x', audits: {y: 'off'}}, recommended)).toThrow(
        /unknown preset "x".*unknown audit "y"/
      );
    });
  });
});
