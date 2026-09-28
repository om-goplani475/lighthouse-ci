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
});
