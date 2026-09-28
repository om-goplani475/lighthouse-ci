/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reports whether a schema type is currently one Google documents support for a rich result
 * at all. Deliberately thin: does NOT re-validate properties (that's the google-requirements
 * engine's job) and never affects an audit's score — always informational, always hedged.
 * Kept as a genuinely separate namespace, not a restatement of the requirements check.
 */

/**
 * @param {string} schemaType
 * @param {import('./types.js').EligibilityRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
export function evaluate(schemaType, ruleset) {
  const typeRule = ruleset.types[schemaType];
  if (!typeRule) return [];

  const message = typeRule.supported
    ? `May be eligible for consideration for ${typeRule.richResultFeature} (as of ruleset ` +
      `${ruleset.version}); valid markup does not guarantee Google will display a rich result.`
    : `${schemaType} is not currently documented as supported for a Google rich result ` +
      `(as of ruleset ${ruleset.version}).`;

  return [
    {
      namespace: 'eligibility',
      type: schemaType,
      property: '',
      severity: 'info',
      message,
    },
  ];
}
