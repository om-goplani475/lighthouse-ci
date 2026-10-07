/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {extractTypedEntities} = require('../../src/lib/json-ld-graph.js');

describe('extractTypedEntities — no @graph (existing single-block behavior)', () => {
  it('returns the one typed entity for a plain block', () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Widget',
    });
    expect(extractTypedEntities(content)).toEqual([
      {
        type: 'Product',
        data: {'@context': 'https://schema.org', '@type': 'Product', name: 'Widget'},
      },
    ]);
  });

  it('returns nothing for untyped JSON', () => {
    expect(extractTypedEntities(JSON.stringify({'@context': 'https://schema.org'}))).toEqual([]);
  });

  it('returns nothing for invalid JSON', () => {
    expect(extractTypedEntities('not json')).toEqual([]);
  });

  it('returns nothing for a non-object JSON value', () => {
    expect(extractTypedEntities('42')).toEqual([]);
    expect(extractTypedEntities('[1,2,3]')).toEqual([]);
  });
});

describe('extractTypedEntities — @graph unwrapping', () => {
  it('extracts every typed entity from a @graph container', () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {'@type': 'Product', name: 'Widget'},
        {'@type': 'Organization', name: 'Acme'},
      ],
    });
    const entities = extractTypedEntities(content);
    expect(entities.map(e => e.type)).toEqual(['Product', 'Organization']);
  });

  it('skips an untyped entry within @graph rather than failing the whole block', () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{'@type': 'Product', name: 'Widget'}, {name: 'No type here'}],
    });
    const entities = extractTypedEntities(content);
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('Product');
  });

  it('returns an empty array for an empty @graph', () => {
    const content = JSON.stringify({'@context': 'https://schema.org', '@graph': []});
    expect(extractTypedEntities(content)).toEqual([]);
  });
});

describe('extractTypedEntities — @id reference resolution', () => {
  it('resolves a bare {"@id": ...} property reference to the sibling entity in the same @graph', () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {'@id': '#org', '@type': 'Organization', name: 'Acme'},
        {'@type': 'Article', headline: 'A Post', author: {'@id': '#org'}},
      ],
    });
    const entities = extractTypedEntities(content);
    const article = entities.find(e => e.type === 'Article');
    expect(article.data.author).toEqual({'@id': '#org', '@type': 'Organization', name: 'Acme'});
  });

  it('resolves references inside an array-valued property', () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {'@id': '#offer1', '@type': 'Offer', price: '9.99'},
        {'@type': 'Product', name: 'Widget', offers: [{'@id': '#offer1'}]},
      ],
    });
    const entities = extractTypedEntities(content);
    const product = entities.find(e => e.type === 'Product');
    expect(product.data.offers).toEqual([{'@id': '#offer1', '@type': 'Offer', price: '9.99'}]);
  });

  it('leaves an unresolvable reference (no matching @id in the graph) as-is, not dropped', () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{'@type': 'Article', headline: 'A Post', author: {'@id': '#missing'}}],
    });
    const entities = extractTypedEntities(content);
    expect(entities[0].data.author).toEqual({'@id': '#missing'});
  });

  it('does not treat an inline node that happens to have its own @id as a reference', () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Product',
          name: 'Widget',
          offers: {'@id': '#offer1', '@type': 'Offer', price: '9.99'},
        },
      ],
    });
    const entities = extractTypedEntities(content);
    // Already a full inline node (more than just @id) — resolveValue must not alter it, and
    // there's nothing to resolve it *against* anyway since no other node declares #offer1.
    expect(entities[0].data.offers).toEqual({'@id': '#offer1', '@type': 'Offer', price: '9.99'});
  });

  it("does not chase a resolved node's own references (one level deep only)", () => {
    const content = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {'@id': '#country', '@type': 'Country', name: 'USA'},
        {'@id': '#org', '@type': 'Organization', name: 'Acme', address: {'@id': '#country'}},
        {'@type': 'Article', headline: 'A Post', author: {'@id': '#org'}},
      ],
    });
    const entities = extractTypedEntities(content);
    const article = entities.find(e => e.type === 'Article');
    // author resolves to the Organization node, but that node's own `address` reference is left
    // exactly as authored (still a bare {"@id": "#country"} reference, not further resolved).
    expect(article.data.author.address).toEqual({'@id': '#country'});
  });
});

describe('extractTypedEntities: a top-level array (valid JSON-LD, used by real shops)', () => {
  const product = name => ({'@context': 'https://schema.org', '@type': 'Product', name});

  it('returns the typed entities of every element', () => {
    const content = JSON.stringify([
      product('A'),
      {'@context': 'https://schema.org', '@type': 'Organization', name: 'O'},
      product('B'),
    ]);
    expect(extractTypedEntities(content).map(e => [e.type, e.data.name])).toEqual([
      ['Product', 'A'],
      ['Organization', 'O'],
      ['Product', 'B'],
    ]);
  });

  it('unwraps a @graph inside an element, and skips elements that are not objects or have no type', () => {
    const content = JSON.stringify([
      {'@context': 'https://schema.org', '@graph': [{'@type': 'Article', headline: 'H'}]},
      42,
      null,
      'text',
      {'@context': 'https://schema.org'},
      [product('nested arrays are not JSON-LD documents')],
    ]);
    expect(extractTypedEntities(content).map(e => e.type)).toEqual(['Article']);
  });

  it('is empty for an empty array', () => {
    expect(extractTypedEntities('[]')).toEqual([]);
  });
});
