/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

import {evaluate} from '../../src/rule-engine/schema-org-deprecations-engine.js';

const ruleset = {
  version: '2026-10',
  types: {
    Product: {deprecated: {reviews: 'review'}},
    Review: {deprecated: {}},
  },
};

describe('schema-org-deprecations-engine', () => {
  it('returns no findings for an untracked type', () => {
    expect(evaluate('WebSite', {reviews: []}, ruleset)).toEqual([]);
  });

  it('returns no findings when the deprecated property is absent', () => {
    expect(evaluate('Product', {name: 'Widget'}, ruleset)).toEqual([]);
  });

  it('returns no findings for a tracked type with an empty deprecated map', () => {
    expect(evaluate('Review', {reviews: []}, ruleset)).toEqual([]);
  });

  it('flags a deprecated property that is present, naming its replacement', () => {
    const findings = evaluate('Product', {reviews: []}, ruleset);
    expect(findings).toEqual([
      {
        namespace: 'deprecated-property',
        type: 'Product',
        property: 'reviews',
        severity: 'info',
        message:
          '"reviews" is a deprecated schema.org property (as of ruleset 2026-10); use "review" instead.',
      },
    ]);
  });

  it('never affects severity beyond info, even when the property is present', () => {
    const findings = evaluate('Product', {reviews: []}, ruleset);
    expect(findings[0].severity).toBe('info');
  });
});
