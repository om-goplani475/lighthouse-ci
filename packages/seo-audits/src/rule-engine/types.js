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

/** @typedef {{type: string, required: string[]}} GoogleRuleSetNestedRule */
/**
 * @typedef {{
 *   required: string[],
 *   nested: Record<string, GoogleRuleSetNestedRule>,
 *   conditional: Array<{if: object, then: object}>,
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
