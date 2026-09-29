/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {findDuplicates, findConflicts} from '../rule-engine/type-conflicts-engine.js';
import {resolveTypeConflictsRuleset} from '../rule-engine/registry.js';

const ruleset = resolveTypeConflictsRuleset();
const relevantTypes = new Set([...ruleset.singularTypes, ...Object.keys(ruleset.identityFields)]);

const UIStrings = {
  title: 'No duplicate or conflicting structured data found',
  failureTitle: 'Structured data has duplicate or conflicting blocks',
  description:
    'Checks JSON-LD blocks against each other for two kinds of issue: a schema type that ' +
    'should appear at most once per page appearing more than once (scored — a clear markup ' +
    'mistake), and two blocks of the same type that share a strong identity field (e.g. ' +
    "Product.sku) but disagree on another field (informational only — this audit's " +
    'conflicting-entity check only compares blocks that share a real identity signal, so it ' +
    "won't flag legitimately different entities of the same schema type, like a product " +
    'listing page with multiple distinct products).',
};

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
// type from an out-of-tree package — same boundary already documented in the sibling audits.
class StructuredDataTypeConflicts extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'structured-data-type-conflicts',
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
    // Object.create(null) rather than {} — the key is the page's own JSON-LD "@type" value,
    // fully attacker/page-controlled. A block declaring "@type": "__proto__" against a plain
    // object literal would silently reassign that object's own prototype via the inherited
    // __proto__ setter (confirmed: doesn't pollute the global Object.prototype, but does
    // corrupt this object's own behavior) instead of creating a normal "__proto__" property.
    // A null-prototype object has no such setter, so every key behaves as a plain data key.
    /** @type {Record<string, number>} */
    const typeCounts = Object.create(null);
    /** @type {Record<string, Record<string, unknown>[]>} */
    const blocksByType = Object.create(null);

    artifacts.StructuredDataJsonLd.forEach(block => {
      const parsed = tryParse(block.content);
      if (!isObject(parsed) || typeof parsed['@type'] !== 'string') return;

      const schemaType = parsed['@type'];
      typeCounts[schemaType] = (typeCounts[schemaType] || 0) + 1;
      (blocksByType[schemaType] = blocksByType[schemaType] || []).push(parsed);
    });

    const hasRelevantBlock = Object.keys(typeCounts).some(type => relevantTypes.has(type));
    if (!hasRelevantBlock) {
      return {score: null, notApplicable: true};
    }

    const duplicateFindings = findDuplicates(typeCounts, ruleset);
    const conflictFindings = findConflicts(blocksByType, ruleset);

    /** @type {Array<{namespace: string, type: string, detail: string, message: string}>} */
    const rows = [
      ...duplicateFindings.map(finding => ({
        namespace: finding.namespace,
        type: finding.type,
        detail: `${typeCounts[finding.type]} ${finding.type} blocks (expected at most 1)`,
        message: finding.message,
      })),
      ...conflictFindings.map(finding => ({
        namespace: finding.namespace,
        type: finding.type,
        detail: finding.property,
        message: finding.message,
      })),
    ];

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'namespace', valueType: 'text', label: 'Namespace'},
      {key: 'type', valueType: 'text', label: 'Type'},
      {key: 'detail', valueType: 'text', label: 'Detail'},
      {key: 'message', valueType: 'text', label: 'Message'},
    ];

    const details = Audit.makeTableDetails(headings, rows);
    // @ts-expect-error - rulesetVersions isn't part of Lighthouse's Details.Table type — see
    // the sibling audits for the same reproducibility-stamp rationale.
    details.rulesetVersions = {typeConflicts: ruleset.version};

    return {
      score: Number(duplicateFindings.length === 0),
      details,
    };
  }
}

export default StructuredDataTypeConflicts;
export {UIStrings};
