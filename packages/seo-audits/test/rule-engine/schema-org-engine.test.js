/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

import {validate} from '../../src/rule-engine/schema-org-engine.js';

const ruleset = {
  version: '2026-09',
  universal: {required: ['@context', '@type']},
  types: {},
};

describe('schema-org-engine', () => {
  it('passes a block with both required universal fields', () => {
    const findings = validate({'@context': 'https://schema.org', '@type': 'Article'}, ruleset);
    expect(findings).toEqual([]);
  });

  it('flags a missing universal field', () => {
    const findings = validate({'@context': 'https://schema.org'}, ruleset);
    expect(findings).toEqual([
      {
        namespace: 'schema-org',
        type: 'universal',
        property: '@type',
        severity: 'error',
        message: 'Missing @type',
      },
    ]);
  });

  describe('@graph containers', () => {
    it('passes a well-formed container — no false "Missing @type" on the container itself', () => {
      const findings = validate(
        {
          '@context': 'https://schema.org',
          '@graph': [
            {'@type': 'Product', name: 'Widget'},
            {'@type': 'Organization', name: 'Acme'},
          ],
        },
        ruleset
      );
      expect(findings).toEqual([]);
    });

    it('flags a missing container-level @context', () => {
      const findings = validate({'@graph': [{'@type': 'Product'}]}, ruleset);
      expect(findings).toEqual([
        {
          namespace: 'schema-org',
          type: 'universal',
          property: '@context',
          severity: 'error',
          message: 'Missing @context',
        },
      ]);
    });

    it('flags an empty @graph', () => {
      const findings = validate({'@context': 'https://schema.org', '@graph': []}, ruleset);
      expect(findings).toEqual([
        {
          namespace: 'schema-org',
          type: 'universal',
          property: '@graph',
          severity: 'error',
          message: '@graph is empty',
        },
      ]);
    });

    it('flags an entry within @graph missing its own @type, indexed', () => {
      const findings = validate(
        {
          '@context': 'https://schema.org',
          '@graph': [{'@type': 'Product'}, {name: 'No type'}],
        },
        ruleset
      );
      expect(findings).toEqual([
        {
          namespace: 'schema-org',
          type: 'universal',
          property: '@graph[1].@type',
          severity: 'error',
          message: 'Missing @type on @graph[1]',
        },
      ]);
    });

    it('does not require @context on each individual @graph entry (inherited from the container)', () => {
      const findings = validate(
        {'@context': 'https://schema.org', '@graph': [{'@type': 'Product', name: 'Widget'}]},
        ruleset
      );
      expect(findings).toEqual([]);
    });
  });
});
