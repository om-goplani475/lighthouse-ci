/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Validates a parsed JSON-LD block against Google's published structured-data requirements
 * for its schema type — required + recommended properties, treated as one severity (per the
 * structured-data-schema-properties feature's intake decision), and one level of nested
 * required sub-objects (e.g. Product.offers). `conditional` rules are parsed by the registry
 * but not evaluated here in v1 — reserved for a later feature.
 */

/**
 * @param {unknown} value
 * @return {Record<string, unknown>[]}
 */
function asObjectArray(value) {
  const items = Array.isArray(value) ? value : [value];
  return items.filter(item => typeof item === 'object' && item !== null);
}

/**
 * @param {string} schemaType
 * @param {Record<string, unknown>} parsedBlock
 * @param {import('./types.js').GoogleRequirementsRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
export function validate(schemaType, parsedBlock, ruleset) {
  const typeRule = ruleset.types[schemaType];
  if (!typeRule) return [];

  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  for (const property of typeRule.required) {
    if (!(property in parsedBlock)) {
      findings.push({
        namespace: 'google-requirements',
        type: schemaType,
        property,
        severity: 'error',
        message: `Missing ${property}`,
      });
    }
  }

  for (const [property, nestedRule] of Object.entries(typeRule.nested)) {
    if (!(property in parsedBlock)) continue;

    const instances = asObjectArray(parsedBlock[property]);
    instances.forEach((instance, index) => {
      const label = instances.length > 1 ? `${property}[${index}]` : property;
      for (const nestedProperty of nestedRule.required) {
        if (!(nestedProperty in instance)) {
          findings.push({
            namespace: 'google-requirements',
            type: schemaType,
            property: `${label}.${nestedProperty}`,
            severity: 'error',
            message: `Missing ${label}.${nestedProperty}`,
          });
        }
      }
    });
  }

  return findings;
}
