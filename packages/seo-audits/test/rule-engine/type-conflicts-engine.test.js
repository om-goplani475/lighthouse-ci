/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

import {findDuplicates, findConflicts} from '../../src/rule-engine/type-conflicts-engine.js';

const ruleset = {
  version: '2026-10',
  singularTypes: ['Organization', 'WebSite'],
  identityFields: {
    Product: ['sku', 'gtin', 'mpn'],
  },
};

describe('type-conflicts-engine — findDuplicates', () => {
  it('flags a singular type that appears more than once', () => {
    const findings = findDuplicates({Organization: 2}, ruleset);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(
      expect.objectContaining({
        namespace: 'duplicate-count',
        type: 'Organization',
        severity: 'error',
      })
    );
  });

  it('does not flag a singular type appearing once', () => {
    expect(findDuplicates({Organization: 1}, ruleset)).toEqual([]);
  });

  it('does not flag a singular type appearing zero times', () => {
    expect(findDuplicates({}, ruleset)).toEqual([]);
  });

  it('never flags a type that is not in singularTypes, no matter how many times it appears', () => {
    expect(findDuplicates({Product: 50}, ruleset)).toEqual([]);
  });
});

describe('type-conflicts-engine — findConflicts', () => {
  it('flags two blocks sharing an identity field that disagree on another field', () => {
    const findings = findConflicts(
      {
        Product: [
          {'@type': 'Product', sku: 'ABC', price: '9.99'},
          {'@type': 'Product', sku: 'ABC', price: '14.99'},
        ],
      },
      ruleset
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(
      expect.objectContaining({
        namespace: 'conflicting-entity',
        type: 'Product',
        property: 'price',
        severity: 'info',
      })
    );
  });

  it('does not flag two blocks with different identity-field values, even if other fields match', () => {
    const findings = findConflicts(
      {
        Product: [
          {'@type': 'Product', sku: 'AAA', price: '9.99'},
          {'@type': 'Product', sku: 'BBB', price: '9.99'},
        ],
      },
      ruleset
    );
    expect(findings).toEqual([]);
  });

  it('never groups a block with no identity field present, even if its other fields match another block', () => {
    const findings = findConflicts(
      {
        Product: [
          {'@type': 'Product', sku: 'ABC', price: '9.99'},
          {'@type': 'Product', price: '9.99'}, // no sku/gtin/mpn at all
        ],
      },
      ruleset
    );
    expect(findings).toEqual([]);
  });

  it('falls through the identity-field list in order (gtin used when sku is absent)', () => {
    const findings = findConflicts(
      {
        Product: [
          {'@type': 'Product', gtin: 'XYZ', price: '9.99'},
          {'@type': 'Product', gtin: 'XYZ', price: '14.99'},
        ],
      },
      ruleset
    );
    expect(findings).toHaveLength(1);
  });

  it('does not compare the matched identity field itself as a conflicting property', () => {
    const findings = findConflicts(
      {
        Product: [
          {'@type': 'Product', sku: 'ABC'},
          {'@type': 'Product', sku: 'ABC'},
        ],
      },
      ruleset
    );
    expect(findings).toEqual([]);
  });

  it('never checks a type with no identityFields entry at all', () => {
    const findings = findConflicts(
      {
        Review: [
          {'@type': 'Review', author: 'A', reviewRating: 5},
          {'@type': 'Review', author: 'A', reviewRating: 1},
        ],
      },
      ruleset
    );
    expect(findings).toEqual([]);
  });

  it('does not recurse into nested objects when comparing fields', () => {
    const findings = findConflicts(
      {
        Product: [
          {'@type': 'Product', sku: 'ABC', offers: {price: '9.99'}},
          {'@type': 'Product', sku: 'ABC', offers: {price: '14.99'}},
        ],
      },
      ruleset
    );
    // The nested `offers` objects differ, but comparison is top-level only — still flags
    // `offers` itself as a differing top-level key (its JSON-stringified value differs),
    // it just doesn't descend into `offers.price` specifically as its own property.
    expect(findings).toHaveLength(1);
    expect(findings[0].property).toBe('offers');
  });
});
