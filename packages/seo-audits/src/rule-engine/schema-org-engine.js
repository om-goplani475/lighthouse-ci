/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Validates a parsed JSON-LD block against schema.org / JSON-LD structural requirements —
 * v1 only checks the `universal` required fields ("@context" and "@type"), which apply to
 * every block regardless of its schema type. Does not know about Google-specific requirements or
 * rich-result eligibility — those are separate engines, deliberately kept apart.
 */

/**
 * @param {Record<string, unknown>} parsedBlock
 * @param {import('./types.js').SchemaOrgRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
export function validate(parsedBlock, ruleset) {
  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  for (const property of ruleset.universal.required) {
    if (!(property in parsedBlock)) {
      findings.push({
        namespace: 'schema-org',
        type: 'universal',
        property,
        severity: 'error',
        message: `Missing ${property}`,
      });
    }
  }

  return findings;
}
