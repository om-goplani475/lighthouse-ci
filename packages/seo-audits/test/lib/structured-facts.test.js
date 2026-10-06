/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  projectEntities,
  hasType,
  isLocalBusiness,
  isProduct,
  MAX_FACT_CHARS,
  MAX_ENTITIES,
} = require('../../src/lib/structured-facts.js');

const block = obj => JSON.stringify(obj);

describe('projectEntities: shapes', () => {
  it('reads a single typed object, a list, and a @graph, and resolves @id references one level deep', () => {
    expect(
      projectEntities([
        block({'@context': 'https://schema.org', '@type': 'Organization', name: 'Acme'}),
      ])
    ).toHaveLength(1);
    expect(
      projectEntities([
        block([
          {'@type': 'Organization', name: 'A'},
          {'@type': 'Person', name: 'B'},
        ]),
      ])
    ).toHaveLength(2);
    const graph = block({
      '@graph': [
        {'@type': 'Organization', '@id': '#org', name: 'Acme', sameAs: ['https://x.example/acme']},
        {'@type': 'WebSite', url: 'https://acme.example/', publisher: {'@id': '#org'}},
        {'@type': 'Product', name: 'Shoe', brand: {'@id': '#org'}},
      ],
    });
    const entities = projectEntities([graph]);
    expect(entities.map(e => e.types[0])).toEqual(['Organization', 'WebSite', 'Product']);
    expect(entities[2].product.brand).toBe('Acme');
  });

  it('keeps @type lists, skips untyped nodes, and survives junk, empty and non-string input', () => {
    expect(
      projectEntities([block({'@type': ['Product', 'ItemPage'], name: 'x'})])[0].types
    ).toEqual(['Product', 'ItemPage']);
    expect(projectEntities([block({name: 'untyped'})])).toEqual([]);
    for (const bad of [null, undefined, 5, '', '{nope', 'null', '[1,2]', '"str"']) {
      expect(projectEntities([bad])).toEqual([]);
    }
    expect(projectEntities(undefined)).toEqual([]);
  });
});

describe('projectEntities: facts', () => {
  const local = projectEntities([
    block({
      '@type': 'Restaurant',
      '@id': 'https://acme.example/#biz',
      name: ' Acme Diner ',
      telephone: '+1 555 0100',
      priceRange: '$$',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '1 Main St',
        addressLocality: 'Springfield',
        postalCode: '12345',
        addressCountry: {'@type': 'Country', name: 'US'},
      },
      geo: {'@type': 'GeoCoordinates', latitude: '40.12345', longitude: -74.5},
      openingHours: ['Mo-Fr 09:00-17:00'],
      openingHoursSpecification: [
        {dayOfWeek: ['Monday', 'Tuesday'], opens: '09:00', closes: '17:00'},
        {dayOfWeek: 'Saturday'},
      ],
      sameAs: ['https://facebook.com/acme', {'@id': 'https://x.example/acme'}],
      logo: {'@type': 'ImageObject', url: 'https://acme.example/logo.png'},
      leiCode: '5493001KJTIIGC8Y1R12',
    }),
  ])[0];

  it('projects identity, address, phone, hours, geo, sameAs, logo and identifiers as short strings', () => {
    expect(local).toMatchObject({
      id: 'https://acme.example/#biz',
      name: 'Acme Diner',
      telephone: '+1 555 0100',
      priceRange: '$$',
      address: {
        streetAddress: '1 Main St',
        addressLocality: 'Springfield',
        addressRegion: null,
        postalCode: '12345',
        addressCountry: 'US',
      },
      geo: {latitude: '40.12345', longitude: '-74.5'},
      openingHours: ['Mo-Fr 09:00-17:00'],
      sameAs: ['https://facebook.com/acme', 'https://x.example/acme'],
      logo: 'https://acme.example/logo.png',
      identifiers: {leiCode: '5493001KJTIIGC8Y1R12'},
    });
    expect(local.openingHoursSpecification).toEqual([
      {dayOfWeek: ['Monday', 'Tuesday'], opens: '09:00', closes: '17:00'},
      {dayOfWeek: ['Saturday'], opens: null, closes: null},
    ]);
    expect(isLocalBusiness(local)).toBe(true);
    expect(isProduct(local)).toBe(false);
  });

  it('keeps product values exactly as written, because the audits judge their format', () => {
    const [p] = projectEntities([
      block({
        '@type': 'Product',
        name: 'Shoe',
        sku: 'AB 12',
        gtin13: '4006381333931',
        mpn: 'M1',
        brand: {'@type': 'Brand', name: 'Acme'},
        image: ['https://x.example/a.jpg'],
        offers: {
          '@type': 'Offer',
          price: '1,299.00',
          priceCurrency: 'usd',
          availability: ['https://schema.org/InStock', 'OutOfStock'],
          itemCondition: 'NewCondition',
          url: 'https://x.example/shoe',
        },
      }),
    ]);
    expect(p.product).toMatchObject({
      sku: 'AB 12',
      gtins: {gtin13: '4006381333931'},
      mpn: 'M1',
      brand: 'Acme',
      hasImage: true,
    });
    expect(p.product.offers[0]).toEqual({
      kind: 'Offer',
      price: '1,299.00',
      lowPrice: null,
      highPrice: null,
      priceCurrency: 'usd',
      availability: ['https://schema.org/InStock', 'OutOfStock'],
      itemCondition: ['NewCondition'],
      url: 'https://x.example/shoe',
    });
    expect(isProduct(p)).toBe(true);
  });

  it('reads a price from priceSpecification, an AggregateOffer, numbers, and variants of a ProductGroup', () => {
    const [group, shoe] = projectEntities([
      block({
        '@graph': [
          {
            '@type': 'ProductGroup',
            name: 'Shoe',
            productGroupID: 'SH',
            variesBy: ['https://schema.org/size', 'color'],
            hasVariant: [
              {'@type': 'Product', name: 'Shoe S', sku: 'SH-S'},
              {'@type': 'Product', name: 'Shoe M', gtin: '123'},
            ],
          },
          {
            '@type': 'Product',
            name: 'Shoe S',
            isVariantOf: {'@type': 'ProductGroup', productGroupID: 'SH'},
            offers: [
              {'@type': 'AggregateOffer', lowPrice: 5, highPrice: 9, priceCurrency: 'EUR'},
              {'@type': 'Offer', priceSpecification: {price: 7.5, priceCurrency: 'EUR'}},
            ],
          },
        ],
      }),
    ]);
    expect(group.product).toMatchObject({
      productGroupID: 'SH',
      variantCount: 2,
      variesBy: ['https://schema.org/size', 'color'],
    });
    expect(group.product.variants.map(v => v.sku || v.gtin)).toEqual(['SH-S', '123']);
    expect(group.product.variants.every(v => v.detailed)).toBe(true);
    expect(shoe.product.isVariantOf).toBe('SH');
    expect(shoe.product.offers.map(o => [o.kind, o.price, o.lowPrice, o.priceCurrency])).toEqual([
      ['AggregateOffer', null, '5', 'EUR'],
      ['Offer', '7.5', null, 'EUR'],
    ]);
  });

  it('marks a variant that is only a pointer to its own page as not detailed', () => {
    const [group] = projectEntities([
      block({
        '@type': 'ProductGroup',
        name: 'G',
        hasVariant: [
          {'@type': 'Product', url: 'https://x.example/v1'},
          {'@type': 'Product', '@id': '#v2', url: 'https://x.example/v2'},
          {'@type': 'Product', name: 'v3'},
        ],
      }),
    ]);
    expect(group.product.variants.map(v => [v.url, v.detailed])).toEqual([
      ['https://x.example/v1', false],
      ['https://x.example/v2', false],
      [null, true],
    ]);
    expect(group.product.variantCount).toBe(3);
  });

  it('recognises local business subtypes and types given as a list', () => {
    expect(hasType({types: ['Thing', 'Dentist']}, 'Dentist')).toBe(true);
    expect(isLocalBusiness({types: ['Dentist']})).toBe(true);
    expect(isLocalBusiness({types: ['Organization']})).toBe(false);
  });
});

describe('projectEntities: bounds against a hostile page', () => {
  it('caps entities, total size, list lengths and string lengths', () => {
    const many = Array.from({length: 200}, (_, i) => ({'@type': 'Thing', name: `n${i}`}));
    expect(projectEntities([block(many)]).length).toBeLessThanOrEqual(MAX_ENTITIES);
    const fat = {
      '@type': 'Organization',
      name: 'x'.repeat(100000),
      sameAs: Array.from({length: 500}, (_, i) => `https://e.example/${i}`),
    };
    const [org] = projectEntities([block(fat)]);
    expect(org.name.length).toBe(200);
    expect(org.sameAs.length).toBe(20);
    const total = projectEntities(
      Array.from({length: 10}, () =>
        block({
          '@type': 'Organization',
          name: 'y'.repeat(200),
          sameAs: Array.from({length: 20}, (_, i) => `https://e.example/${'p'.repeat(150)}${i}`),
        })
      )
    );
    expect(JSON.stringify(total).length).toBeLessThanOrEqual(MAX_FACT_CHARS + 10);
  });

  it('ignores blocks beyond the tenth and any block over 200,000 characters', () => {
    const blocks = Array.from({length: 15}, (_, i) =>
      block({'@type': 'Organization', name: `o${i}`})
    );
    expect(projectEntities(blocks).map(e => e.name)).toEqual(
      blocks.slice(0, 10).map((_, i) => `o${i}`)
    );
    expect(
      projectEntities([block({'@type': 'Organization', name: 'x', pad: 'z'.repeat(200001)})])
    ).toEqual([]);
  });

  it('survives deep nesting, cycles by id, and odd property types', () => {
    // Built as text: JSON.stringify itself overflows the stack on an object this deep.
    const deep = '{"@type":"Thing","nested":'.repeat(5000) + '1' + '}'.repeat(5000);
    expect(() => projectEntities([deep])).not.toThrow();
    const cyc = {
      '@graph': [
        {
          '@type': 'Organization',
          '@id': '#a',
          name: 'A',
          brand: {'@id': '#a'},
          address: {'@id': '#a'},
          sameAs: {'@id': '#a'},
        },
      ],
    };
    expect(() => projectEntities([block(cyc)])).not.toThrow();
    expect(() =>
      projectEntities([
        block({
          '@type': 'Product',
          offers: 5,
          brand: [],
          sku: {},
          image: null,
          hasVariant: 'x',
          geo: 'x',
          address: 7,
          openingHoursSpecification: 'x',
        }),
      ])
    ).not.toThrow();
  });
});
