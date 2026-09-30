/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {evaluate as evaluateDeprecations} from '../rule-engine/schema-org-deprecations-engine.js';
import {resolveSchemaOrgDeprecationsRuleset} from '../rule-engine/registry.js';
import {extractTypedEntities} from '../lib/json-ld-graph.js';

const deprecationsRuleset = resolveSchemaOrgDeprecationsRuleset();

const UIStrings = {
  title: 'No deprecated schema.org properties used',
  description:
    'For each JSON-LD block whose schema type Google documents rich-result support for ' +
    '(v1: Product, Article, Event, JobPosting, VideoObject, Review), reports any property ' +
    'schema.org has superseded with a newer name. A deprecated property usually still works ' +
    'and Google may still honor it — this is informational, not a validity check, and never ' +
    'affects a score.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts
// type from an out-of-tree package — same boundary already documented in the sibling audits.
class StructuredDataDeprecatedProperties extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'structured-data-deprecated-properties',
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
    /** @type {Array<{blockIndex: number, type: string, property: string, message: string}>} */
    const rows = [];
    let anyTrackedType = false;

    artifacts.StructuredDataJsonLd.forEach((block, blockIndex) => {
      // extractTypedEntities also unwraps @graph containers, same as the sibling audits.
      for (const {type: schemaType, data} of extractTypedEntities(block.content)) {
        if (!deprecationsRuleset.types[schemaType]) continue;

        anyTrackedType = true;

        for (const finding of evaluateDeprecations(schemaType, data, deprecationsRuleset)) {
          rows.push({
            blockIndex,
            type: schemaType,
            property: finding.property,
            message: finding.message,
          });
        }
      }
    });

    if (!anyTrackedType) {
      return {score: null, notApplicable: true};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'blockIndex', valueType: 'numeric', label: 'Block'},
      {key: 'type', valueType: 'text', label: 'Type'},
      {key: 'property', valueType: 'text', label: 'Property'},
      {key: 'message', valueType: 'text', label: 'Message'},
    ];

    const details = Audit.makeTableDetails(headings, rows);
    // @ts-expect-error - rulesetVersions isn't part of Lighthouse's Details.Table type — see
    // the sibling audits for the same reproducibility-stamp rationale.
    details.rulesetVersions = {schemaOrgDeprecations: deprecationsRuleset.version};

    return {
      score: null,
      details,
    };
  }
}

export default StructuredDataDeprecatedProperties;
export {UIStrings};
