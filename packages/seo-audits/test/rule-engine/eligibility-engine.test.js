/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

import {evaluate} from '../../src/rule-engine/eligibility-engine.js';

const ruleset = {
  version: '2026-09',
  types: {
    Product: {supported: true, richResultFeature: 'Product snippets'},
    DeprecatedType: {supported: false, richResultFeature: ''},
  },
};

describe('eligibility-engine', () => {
  it('returns no findings for an untracked type', () => {
    expect(evaluate('WebSite', ruleset)).toEqual([]);
  });

  it('returns a hedged informational finding for a supported type', () => {
    const findings = evaluate('Product', ruleset);
    expect(findings).toHaveLength(1);
    expect(findings[0].namespace).toBe('eligibility');
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('Product snippets');
    expect(findings[0].message).toContain('does not guarantee');
  });

  it('appends the rule note, so FAQ does not read as useless markup', () => {
    const withNote = {
      version: '2026-10',
      types: {
        FAQPage: {
          supported: false,
          richResultFeature: 'FAQ rich results',
          note: 'Still shown for authoritative government and health sites.',
        },
      },
    };
    const findings = evaluate('FAQPage', withNote);
    expect(findings[0].message).toMatch(
      /not currently documented as supported.*government and health/
    );
  });

  it('never uses error severity, even for an unsupported type', () => {
    const findings = evaluate('DeprecatedType', ruleset);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('not currently documented as supported');
  });
});
