/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

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

  const hasRequiredFields =
    typeof parsed === 'object' && parsed !== null && '@context' in parsed && '@type' in parsed;
  if (!hasRequiredFields) {
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

    return {
      score: Number(allValid),
      details,
    };
  }
}

export default StructuredDataJsonLd;
export {UIStrings};
