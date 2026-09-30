/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reports usage of schema.org properties that schema.org itself has superseded with a newer
 * property name, for the schema types this fork already validates most deeply (the
 * google-requirements set: Product, Article, Event, JobPosting, VideoObject, Review). Checks
 * only the entity's own top-level properties, not nested sub-objects — same narrow-first
 * scoping the datatype-validation and google-requirements engines already use. Deliberately
 * thin, like the eligibility engine: never affects an audit's score, a deprecated property
 * usually still works, it's just discouraged going forward.
 */

/**
 * @param {string} schemaType
 * @param {Record<string, unknown>} data
 * @param {import('./types.js').SchemaOrgDeprecationsRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
export function evaluate(schemaType, data, ruleset) {
  const typeRule = ruleset.types[schemaType];
  if (!typeRule) return [];

  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  for (const [deprecatedProperty, replacement] of Object.entries(typeRule.deprecated)) {
    if (!(deprecatedProperty in data)) continue;

    findings.push({
      namespace: 'deprecated-property',
      type: schemaType,
      property: deprecatedProperty,
      severity: 'info',
      message:
        `"${deprecatedProperty}" is a deprecated schema.org property (as of ruleset ` +
        `${ruleset.version}); use "${replacement}" instead.`,
    });
  }

  return findings;
}
