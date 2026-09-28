/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

import {validate} from '../../src/rule-engine/google-requirements-engine.js';

const ruleset = {
  version: '2026-09',
  types: {
    Product: {
      required: ['name', 'image', 'offers'],
      nested: {offers: {type: 'Offer', required: ['price', 'priceCurrency', 'availability']}},
      conditional: [],
    },
    Article: {
      required: ['headline', 'image', 'datePublished'],
      nested: {},
      conditional: [],
    },
  },
};

describe('google-requirements-engine', () => {
  it('returns no findings for an untracked type', () => {
    expect(validate('WebSite', {}, ruleset)).toEqual([]);
  });

  it('passes a Product with all required fields including nested offers', () => {
    const block = {
      name: 'Widget',
      image: 'https://example.com/widget.jpg',
      offers: {price: '9.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
    };
    expect(validate('Product', block, ruleset)).toEqual([]);
  });

  it('flags a missing nested required property (Product.offers.availability)', () => {
    const block = {
      name: 'Widget',
      image: 'https://example.com/widget.jpg',
      offers: {price: '9.99', priceCurrency: 'USD'},
    };
    const findings = validate('Product', block, ruleset);
    expect(findings).toEqual([
      {
        namespace: 'google-requirements',
        type: 'Product',
        property: 'offers.availability',
        severity: 'error',
        message: 'Missing offers.availability',
      },
    ]);
  });

  it('flags a missing top-level required property on a flat type (Article)', () => {
    const block = {headline: 'Title', image: 'https://example.com/a.jpg'};
    const findings = validate('Article', block, ruleset);
    expect(findings).toEqual([
      {
        namespace: 'google-requirements',
        type: 'Article',
        property: 'datePublished',
        severity: 'error',
        message: 'Missing datePublished',
      },
    ]);
  });

  it('checks every instance when a nested property is an array', () => {
    const block = {
      name: 'Widget',
      image: 'https://example.com/widget.jpg',
      offers: [
        {price: '9.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
        {price: '19.99', priceCurrency: 'USD'},
      ],
    };
    const findings = validate('Product', block, ruleset);
    expect(findings).toEqual([
      {
        namespace: 'google-requirements',
        type: 'Product',
        property: 'offers[1].availability',
        severity: 'error',
        message: 'Missing offers[1].availability',
      },
    ]);
  });
});
