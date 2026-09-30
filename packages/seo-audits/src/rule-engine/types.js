/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @typedef {'schema-org' | 'google-requirements' | 'eligibility' | 'duplicate-count' |
 *   'conflicting-entity'} FindingNamespace
 * @typedef {'error' | 'info'} FindingSeverity
 */

/**
 * @typedef {{
 *   namespace: FindingNamespace,
 *   type: string,
 *   property: string,
 *   severity: FindingSeverity,
 *   message: string,
 * }} Finding
 */

/** @typedef {{required: string[]}} SchemaOrgRuleSetUniversal */
/**
 * @typedef {{version: string, universal: SchemaOrgRuleSetUniversal, types: object}} SchemaOrgRuleSet
 */

/**
 * A property's expected value shape, checked only when the property is present (missing is
 * `required`'s concern, not this one's). `'number'` accepts a JS number or a numeric string
 * (schema.org allows either for e.g. `price`); `'date'` requires an ISO-8601-shaped date/datetime
 * string; `'currency'` requires a 3-uppercase-letter ISO 4217-shaped code (format only, not
 * validated against the real currency-code list — see the feature spec for why).
 * @typedef {'number' | 'date' | 'currency'} GoogleRuleSetDatatype
 */

/**
 * @typedef {{
 *   type: string,
 *   required: string[],
 *   datatypes?: Record<string, GoogleRuleSetDatatype>,
 * }} GoogleRuleSetNestedRule
 */
/**
 * @typedef {{
 *   required: string[],
 *   nested: Record<string, GoogleRuleSetNestedRule>,
 *   conditional: Array<{if: object, then: object}>,
 *   datatypes?: Record<string, GoogleRuleSetDatatype>,
 * }} GoogleRuleSetTypeRule
 */
/**
 * @typedef {{version: string, types: Record<string, GoogleRuleSetTypeRule>}} GoogleRequirementsRuleSet
 */

/** @typedef {{supported: boolean, richResultFeature: string}} EligibilityRuleSetTypeRule */
/**
 * @typedef {{version: string, types: Record<string, EligibilityRuleSetTypeRule>}} EligibilityRuleSet
 */

/**
 * @typedef {{
 *   version: string,
 *   singularTypes: string[],
 *   identityFields: Record<string, string[]>,
 * }} TypeConflictsRuleSet
 */

/** @typedef {{font: string, maxWidthPx: {desktop: number, mobile: number}}} SerpPixelBudgetsField */
/**
 * @typedef {{
 *   version: string,
 *   title: SerpPixelBudgetsField,
 *   description: SerpPixelBudgetsField,
 * }} SerpPixelBudgetsRuleSet
 */

export {};
