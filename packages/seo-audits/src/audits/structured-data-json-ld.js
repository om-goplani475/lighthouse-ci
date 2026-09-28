/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {validate as validateSchemaOrg} from '../rule-engine/schema-org-engine.js';
import {resolveSchemaOrgRuleset} from '../rule-engine/registry.js';

// Resolved once at module load — the ruleset doesn't change within a single audit run, and
// re-reading/re-validating the file on every block would be wasted work.
const schemaOrgRuleset = resolveSchemaOrgRuleset();

const UIStrings = {
  title: 'Structured data (JSON-LD) is valid',
  failureTitle: 'Structured data (JSON-LD) is missing or invalid',
  description:
    'Validates every <script type="application/ld+json"> block on the page: it must ' +
    "be parseable JSON and include the required @context and @type fields. This fork's own " +
    'check — Lighthouse\'s built-in "structured-data" audit is a manual placeholder and does ' +
    'not validate anything automatically.',
  reasonInvalidJson: 'Invalid JSON',
  reasonMissingFields: 'Missing @context or @type',
};

const SNIPPET_LENGTH = 80;

/**
 * @param {string} content
 * @return {string}
 */
function snippetOf(content) {
  const trimmed = content.trim();
  return trimmed.length > SNIPPET_LENGTH ? trimmed.slice(0, SNIPPET_LENGTH) + '…' : trimmed;
}

/**
 * @param {import('../types.js').StructuredDataJsonLdEntry} entry
 * @param {number} index
 * @return {import('../types.js').StructuredDataBlockResult}
 */
function evaluateBlock(entry, index) {
  const snippet = snippetOf(entry.content);

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(entry.content);
  } catch {
    return {index, valid: false, reason: UIStrings.reasonInvalidJson, snippet};
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {index, valid: false, reason: UIStrings.reasonMissingFields, snippet};
  }

  // Migrated onto the schema-org rule engine (was an inline '@context'/'@type' presence
  // check). Collapsed to the same fixed message regardless of which field(s) are missing,
  // preserving the exact pre-migration behavior/wording rather than surfacing the engine's
  // more granular per-property findings here.
  const findings = validateSchemaOrg(
    /** @type {Record<string, unknown>} */ (parsed),
    schemaOrgRuleset
  );
  if (findings.length > 0) {
    return {index, valid: false, reason: UIStrings.reasonMissingFields, snippet};
  }

  return {index, valid: true, reason: '', snippet};
}

// @ts-expect-error - StructuredDataJsonLd (both as a requiredArtifacts entry and as
// the `audit(artifacts)` param shape below) isn't part of Lighthouse's own closed
// Artifacts type, since it's a gatherer contributed by this out-of-tree package, not
// upstream itself. TS anchors this class's static-side incompatibility with the base
// `Audit` class here, at the class declaration, not at the individual `meta`/`audit`
// members. Not augmenting Lighthouse's own ambient types from this package to work
// around it — that would mean patching upstream's types from a consumer, which Option
// B (depend on upstream as a library, never edit/augment its internals) avoids.
class StructuredDataJsonLd extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'structured-data-json-ld',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * Typed against a minimal, local artifacts shape rather than Lighthouse's own
   * closed `LH.Artifacts`, since `StructuredDataJsonLd` isn't (and can't be) a member
   * of that type from an out-of-tree package — same boundary as the gatherer.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const blocks = artifacts.StructuredDataJsonLd;

    if (blocks.length === 0) {
      return {score: 0};
    }

    const results = blocks.map(evaluateBlock);
    const allValid = results.every(r => r.valid);

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'index', valueType: 'numeric', label: '#'},
      {key: 'valid', valueType: 'text', label: 'Valid'},
      {key: 'reason', valueType: 'text', label: 'Reason'},
      {key: 'snippet', valueType: 'code', label: 'Snippet'},
    ];

    const tableItems = results.map(r => ({...r, valid: r.valid ? 'Yes' : 'No'}));
    const details = Audit.makeTableDetails(headings, tableItems);
    // Reproducibility stamp (mirrors Lighthouse's own `lighthouseVersion` on the LHR) — not
    // part of Lighthouse's `Details.Table` type, so it won't render in the HTML report, but
    // it survives in the raw LHR JSON, which is what matters for reproducing an old audit
    // against the ruleset version that produced it.
    // @ts-expect-error - rulesetVersions isn't part of Lighthouse's Details.Table type.
    details.rulesetVersions = {schemaOrg: schemaOrgRuleset.version};

    return {
      score: Number(allValid),
      details,
    };
  }
}

export default StructuredDataJsonLd;
export {UIStrings};
