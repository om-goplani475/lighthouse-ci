/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Validates a parsed JSON-LD block against Google's published structured-data requirements
 * for its schema type — required + recommended properties, treated as one severity (per the
 * structured-data-schema-properties feature's intake decision), one level of nested
 * required sub-objects (e.g. Product.offers), and (added for Phase 2 item 4) datatype checks
 * for a present property's *value*, not just its presence — e.g. Product.offers.price being a
 * non-numeric string. A `required` entry written `a|b` means "at least one of a or b" (Google's Product snippet
 * needs `offers`, `review` or `aggregateRating`). `recommended` properties produce an `info` finding, never an
 * `error`. `conditional` rules are parsed by the registry but not evaluated here in
 * v1 — reserved for a later feature.
 */

/**
 * @param {unknown} value
 * @return {Record<string, unknown>[]}
 */
function asObjectArray(value) {
  const items = Array.isArray(value) ? value : [value];
  return items.filter(item => typeof item === 'object' && item !== null);
}

// A reasonably strict ISO-8601 date/date-time check — deliberately not just `!isNaN(Date.parse())`,
// since `Date.parse` accepts a lot of non-ISO, ambiguous formats (e.g. "10/9/2026") that would
// pass silently despite not being what schema.org's structured-data guidelines call for.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)?)?$/;

// ISO 4217 currency codes are always exactly 3 uppercase letters — format-only, not checked
// against the real ~180-entry currency list (that list changes over time and isn't worth
// versioning as its own ruleset for what this feature needs: catching an obviously-wrong value
// like a currency symbol or a lowercase/malformed code, not a definitive-not-a-real-currency
// judgment).
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/**
 * @param {import('./types.js').GoogleRuleSetDatatype} datatype
 * @param {unknown} value
 * @return {boolean}
 */
function matchesDatatype(datatype, value) {
  if (datatype === 'number') {
    return (
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    );
  }
  if (datatype === 'date') {
    return typeof value === 'string' && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
  }
  if (datatype === 'currency') {
    return typeof value === 'string' && CURRENCY_CODE_RE.test(value);
  }
  return true;
}

/**
 * @param {string} schemaType
 * @param {Record<string, unknown>} object
 * @param {Record<string, import('./types.js').GoogleRuleSetDatatype> | undefined} datatypes
 * @param {string} labelPrefix
 * @return {import('./types.js').Finding[]}
 */
function checkDatatypes(schemaType, object, datatypes, labelPrefix) {
  if (!datatypes) return [];

  /** @type {import('./types.js').Finding[]} */
  const findings = [];
  for (const [property, datatype] of Object.entries(datatypes)) {
    if (!(property in object)) continue; // Missing is `required`'s concern, not this one's.
    const value = object[property];
    if (!matchesDatatype(datatype, value)) {
      const label = `${labelPrefix}${property}`;
      findings.push({
        namespace: 'google-requirements',
        type: schemaType,
        property: label,
        severity: 'error',
        message: `${label} should be a valid ${datatype}, got ${JSON.stringify(value)}`,
      });
    }
  }
  return findings;
}

/**
 * @param {Record<string, unknown>} object
 * @param {string} path A property name, or a path through nested objects such as `item.name`.
 * @return {boolean} Whether the property is present (an array on the way is not followed).
 */
function hasProperty(object, path) {
  /** @type {unknown} */
  let current = object;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return false;
    if (!(part in current)) return false;
    current = /** @type {Record<string, unknown>} */ (current)[part];
  }
  return true;
}

/**
 * @param {string} schemaType
 * @param {Record<string, unknown>} object
 * @param {string[] | undefined} required Property names; `a|b` accepts either; `item.name` means a name inside `item`.
 * @param {string[] | undefined} recommended
 * @param {string} labelPrefix
 * @return {import('./types.js').Finding[]}
 */
function checkPresence(schemaType, object, required, recommended, labelPrefix) {
  /** @type {import('./types.js').Finding[]} */
  const findings = [];
  for (const entry of required || []) {
    const options = entry.split('|');
    if (options.some(option => hasProperty(object, option))) continue;
    const label = options.map(option => `${labelPrefix}${option}`).join(' or ');
    findings.push({
      namespace: 'google-requirements',
      type: schemaType,
      property: label,
      severity: 'error',
      message: `Missing ${label}`,
    });
  }
  for (const property of recommended || []) {
    if (property in object) continue;
    findings.push({
      namespace: 'google-requirements',
      type: schemaType,
      property: `${labelPrefix}${property}`,
      severity: 'info',
      message: `Recommended: add ${labelPrefix}${property}`,
    });
  }
  return findings;
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

  findings.push(
    ...checkPresence(schemaType, parsedBlock, typeRule.required, typeRule.recommended, '')
  );

  findings.push(...checkDatatypes(schemaType, parsedBlock, typeRule.datatypes, ''));

  for (const [property, nestedRule] of Object.entries(typeRule.nested)) {
    if (!(property in parsedBlock)) continue;

    const instances = asObjectArray(parsedBlock[property]);
    instances.forEach((instance, index) => {
      const label = instances.length > 1 ? `${property}[${index}]` : property;
      findings.push(
        ...checkPresence(
          schemaType,
          instance,
          nestedRule.required,
          nestedRule.recommended,
          `${label}.`
        )
      );
      findings.push(...checkDatatypes(schemaType, instance, nestedRule.datatypes, `${label}.`));
    });
  }

  return findings;
}
