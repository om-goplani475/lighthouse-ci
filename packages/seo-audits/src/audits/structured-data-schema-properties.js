/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {validate as validateGoogleRequirements} from '../rule-engine/google-requirements-engine.js';
import {evaluate as evaluateEligibility} from '../rule-engine/eligibility-engine.js';
import {
  resolveGoogleRequirementsRuleset,
  resolveEligibilityRuleset,
} from '../rule-engine/registry.js';
import {extractTypedEntities} from '../lib/json-ld-graph.js';

const googleRuleset = resolveGoogleRequirementsRuleset();
const eligibilityRuleset = resolveEligibilityRuleset();

const UIStrings = {
  title: "Structured data satisfies Google's required properties",
  failureTitle: 'Structured data is missing required properties',
  description:
    'For each JSON-LD block whose schema type Google documents rich-result support for ' +
    "(v1: Product, Article), checks that the properties Google's structured-data guidelines " +
    'call for are present, including specific nested sub-object properties (e.g. ' +
    'Product.offers.price). Also reports, separately and always hedged, whether the type is ' +
    'one Google currently documents support for at all — valid markup never guarantees a rich ' +
    'result will actually display.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts
// type from an out-of-tree package — same boundary already documented in
// structured-data-json-ld.js and the gatherer itself.
class StructuredDataSchemaProperties extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'structured-data-schema-properties',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    /** @type {Array<{blockIndex: number, type: string, namespace: string, property: string, message: string}>} */
    const rows = [];
    let anyTrackedType = false;
    let anyRequirementFailure = false;

    artifacts.StructuredDataJsonLd.forEach((block, blockIndex) => {
      // extractTypedEntities also unwraps @graph containers — one raw <script> block can
      // produce multiple entities here, each still tagged with the same blockIndex so a report
      // reader can trace findings back to the <script> tag they came from.
      for (const {type: schemaType, data} of extractTypedEntities(block.content)) {
        if (!googleRuleset.types[schemaType]) continue;

        anyTrackedType = true;

        const requirementFindings = validateGoogleRequirements(schemaType, data, googleRuleset);
        if (requirementFindings.length > 0) anyRequirementFailure = true;
        for (const finding of requirementFindings) {
          rows.push({
            blockIndex,
            type: schemaType,
            namespace: finding.namespace,
            property: finding.property,
            message: finding.message,
          });
        }

        for (const finding of evaluateEligibility(schemaType, eligibilityRuleset)) {
          rows.push({
            blockIndex,
            type: schemaType,
            namespace: finding.namespace,
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
      {key: 'namespace', valueType: 'text', label: 'Namespace'},
      {key: 'property', valueType: 'text', label: 'Property'},
      {key: 'message', valueType: 'text', label: 'Message'},
    ];

    const details = Audit.makeTableDetails(headings, rows);
    // @ts-expect-error - rulesetVersions isn't part of Lighthouse's Details.Table type — see
    // structured-data-json-ld.js for the same reproducibility-stamp rationale.
    details.rulesetVersions = {
      googleStructuredData: googleRuleset.version,
      eligibility: eligibilityRuleset.version,
    };

    return {
      score: Number(!anyRequirementFailure),
      details,
    };
  }
}

export default StructuredDataSchemaProperties;
export {UIStrings};
