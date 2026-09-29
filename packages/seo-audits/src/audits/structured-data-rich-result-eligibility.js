/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {evaluate as evaluateEligibility} from '../rule-engine/eligibility-engine.js';
import {resolveEligibilityRuleset} from '../rule-engine/registry.js';

const eligibilityRuleset = resolveEligibilityRuleset();

const UIStrings = {
  title: 'Rich-result eligibility is reported',
  description:
    'For each distinct schema type found in JSON-LD on the page, reports whether Google ' +
    'currently documents rich-result guidance for it, and which rich-result feature if so. ' +
    'Purely informational — unlike structured-data-schema-properties, this never affects a ' +
    'score, and unlike that audit it does not skip untracked types: every distinct type found ' +
    'is listed, so this is a complete inventory, not a pass/fail check.',
};

const UNTRACKED_MESSAGE_SUFFIX =
  ' is not a rich-result type Google currently documents guidance for.';

/**
 * @param {unknown} value
 * @return {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * @param {string} content
 * @return {unknown}
 */
function tryParse(content) {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts
// type from an out-of-tree package — same boundary already documented in
// structured-data-json-ld.js and structured-data-schema-properties.js.
class StructuredDataRichResultEligibility extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'structured-data-rich-result-eligibility',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    /** @type {Map<string, {type: string, count: number, tracked: string, richResultFeature: string, message: string}>} */
    const rowsByType = new Map();

    artifacts.StructuredDataJsonLd.forEach(block => {
      const parsed = tryParse(block.content);
      if (!isObject(parsed) || typeof parsed['@type'] !== 'string') return;

      const schemaType = parsed['@type'];
      const existing = rowsByType.get(schemaType);
      if (existing) {
        existing.count++;
        return;
      }

      const typeRule = eligibilityRuleset.types[schemaType];
      if (typeRule) {
        const [finding] = evaluateEligibility(schemaType, eligibilityRuleset);
        rowsByType.set(schemaType, {
          type: schemaType,
          count: 1,
          tracked: 'Yes',
          richResultFeature: typeRule.richResultFeature,
          message: finding.message,
        });
      } else {
        rowsByType.set(schemaType, {
          type: schemaType,
          count: 1,
          tracked: 'No',
          richResultFeature: '',
          message: schemaType + UNTRACKED_MESSAGE_SUFFIX,
        });
      }
    });

    if (rowsByType.size === 0) {
      return {score: null, notApplicable: true};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'type', valueType: 'text', label: 'Type'},
      {key: 'count', valueType: 'numeric', label: 'Count'},
      {key: 'tracked', valueType: 'text', label: 'Tracked'},
      {key: 'richResultFeature', valueType: 'text', label: 'Rich result feature'},
      {key: 'message', valueType: 'text', label: 'Message'},
    ];

    const details = Audit.makeTableDetails(headings, Array.from(rowsByType.values()));
    // @ts-expect-error - rulesetVersions isn't part of Lighthouse's Details.Table type — see
    // the sibling audits for the same reproducibility-stamp rationale.
    details.rulesetVersions = {eligibility: eligibilityRuleset.version};

    return {
      score: null,
      details,
    };
  }
}

export default StructuredDataRichResultEligibility;
export {UIStrings};
