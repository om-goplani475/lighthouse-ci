/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

import StructuredDataJsonLd from '../../src/audits/structured-data-json-ld.js';

/**
 * Audits consume already-gathered artifacts, so these tests mock the gatherer's
 * output directly rather than static HTML fixtures (HTML fixtures test the
 * gatherer's DOM-querying logic, which needs a real page/DOM — out of scope here).
 * @param {string} content
 * @return {{content: string, node: object}}
 */
function block(content) {
  return {content, node: {}};
}

describe('structured-data-json-ld audit', () => {
  it('passes a single valid block', () => {
    const result = StructuredDataJsonLd.audit({
      StructuredDataJsonLd: [block('{"@context": "https://schema.org", "@type": "Article"}')],
    });
    expect(result.score).toBe(1);
  });

  it('passes multiple valid blocks', () => {
    const result = StructuredDataJsonLd.audit({
      StructuredDataJsonLd: [
        block('{"@context": "https://schema.org", "@type": "Article"}'),
        block('{"@context": "https://schema.org", "@type": "Organization"}'),
      ],
    });
    expect(result.score).toBe(1);
  });

  it('fails when there are no blocks at all', () => {
    const result = StructuredDataJsonLd.audit({StructuredDataJsonLd: []});
    expect(result.score).toBe(0);
  });

  it('fails on malformed JSON', () => {
    const result = StructuredDataJsonLd.audit({
      StructuredDataJsonLd: [block('{"@context": "https://schema.org", "@type": }')],
    });
    expect(result.score).toBe(0);
    expect(result.details?.items[0].reason).toBe('Invalid JSON');
  });

  it('fails valid JSON missing @context and @type', () => {
    const result = StructuredDataJsonLd.audit({
      StructuredDataJsonLd: [block('{"headline": "No context or type here"}')],
    });
    expect(result.score).toBe(0);
    expect(result.details?.items[0].reason).toBe('Missing @context or @type');
  });

  it('fails and reports each block individually when one of several is invalid', () => {
    const result = StructuredDataJsonLd.audit({
      StructuredDataJsonLd: [
        block('{"@context": "https://schema.org", "@type": "Article"}'),
        block('not json at all'),
      ],
    });
    expect(result.score).toBe(0);
    expect(result.details?.items).toHaveLength(2);
    expect(result.details?.items[0].valid).toBe('Yes');
    expect(result.details?.items[1].valid).toBe('No');
    expect(result.details?.items[1].reason).toBe('Invalid JSON');
  });
});
