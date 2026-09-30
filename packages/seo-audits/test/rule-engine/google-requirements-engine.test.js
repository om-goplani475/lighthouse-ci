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
      nested: {
        offers: {
          type: 'Offer',
          required: ['price', 'priceCurrency', 'availability'],
          datatypes: {price: 'number', priceCurrency: 'currency'},
        },
      },
      conditional: [],
    },
    Article: {
      required: ['headline', 'image', 'datePublished'],
      nested: {},
      datatypes: {datePublished: 'date'},
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

  it('flags a non-numeric price (the concrete case Phase 2 item 4 exists for)', () => {
    const block = {
      name: 'Widget',
      image: 'https://example.com/widget.jpg',
      offers: {price: 'free', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
    };
    const findings = validate('Product', block, ruleset);
    expect(findings).toEqual([
      {
        namespace: 'google-requirements',
        type: 'Product',
        property: 'offers.price',
        severity: 'error',
        message: 'offers.price should be a valid number, got "free"',
      },
    ]);
  });

  it('accepts a numeric-string price (schema.org allows Number or Text)', () => {
    const block = {
      name: 'Widget',
      image: 'https://example.com/widget.jpg',
      offers: {price: '9.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
    };
    expect(validate('Product', block, ruleset)).toEqual([]);
  });

  it('flags a malformed currency code', () => {
    const block = {
      name: 'Widget',
      image: 'https://example.com/widget.jpg',
      offers: {price: '9.99', priceCurrency: '$', availability: 'https://schema.org/InStock'},
    };
    const findings = validate('Product', block, ruleset);
    expect(findings).toEqual([
      expect.objectContaining({property: 'offers.priceCurrency', severity: 'error'}),
    ]);
  });

  it('flags a non-ISO-8601 date', () => {
    const block = {
      headline: 'Title',
      image: 'https://example.com/a.jpg',
      datePublished: '10/9/2026',
    };
    const findings = validate('Article', block, ruleset);
    expect(findings).toEqual([
      {
        namespace: 'google-requirements',
        type: 'Article',
        property: 'datePublished',
        severity: 'error',
        message: 'datePublished should be a valid date, got "10/9/2026"',
      },
    ]);
  });

  it('accepts a valid ISO-8601 date, date-only or with a time component', () => {
    const dateOnly = {
      headline: 'Title',
      image: 'https://example.com/a.jpg',
      datePublished: '2026-09-30',
    };
    const dateTime = {
      headline: 'Title',
      image: 'https://example.com/a.jpg',
      datePublished: '2026-09-30T12:00:00Z',
    };
    expect(validate('Article', dateOnly, ruleset)).toEqual([]);
    expect(validate('Article', dateTime, ruleset)).toEqual([]);
  });

  it("does not flag a datatype when the property is absent (that is required's concern, not datatypes')", () => {
    const block = {headline: 'Title', image: 'https://example.com/a.jpg'};
    const findings = validate('Article', block, ruleset);
    expect(findings).toEqual([expect.objectContaining({message: 'Missing datePublished'})]);
  });

  it('checks datatypes per-instance when a nested property is an array', () => {
    const block = {
      name: 'Widget',
      image: 'https://example.com/widget.jpg',
      offers: [
        {price: '9.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
        {price: 'invalid', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
      ],
    };
    const findings = validate('Product', block, ruleset);
    expect(findings).toEqual([
      expect.objectContaining({
        property: 'offers[1].price',
        message: expect.stringContaining('invalid'),
      }),
    ]);
  });
});
