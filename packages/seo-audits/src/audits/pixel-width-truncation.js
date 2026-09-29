/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {resolveSerpPixelBudgetsRuleset} from '../rule-engine/registry.js';

const serpPixelBudgetsRuleset = resolveSerpPixelBudgetsRuleset();

const UIStrings = {
  title: 'Title and meta description fit within an approximate SERP pixel-width budget',
  failureTitle:
    'Title or meta description may be truncated based on an approximate rendering model',
  description:
    'Google truncates search-result snippets by rendered pixel width, not character count, so ' +
    'two texts of the same length can truncate differently. Google does not officially publish ' +
    'the exact font or pixel budget it uses, so the values checked here are a widely-cited ' +
    'industry approximation, not a verified fact — a flagged row means the text may be ' +
    'truncated under this approximate model, not that it will definitely be truncated.',
};

/**
 * One row of the audit's details table — one per field found over its pixel budget.
 * @typedef {{field: 'title' | 'description', widthPx: number, maxWidthPx: number, text: string}} PixelWidthRow
 */

/**
 * @param {'title' | 'description'} field
 * @param {import('../gatherers/pixel-width.js').PixelWidthMeasurement} measurement
 * @param {'mobile' | 'desktop'} formFactor
 * @return {PixelWidthRow | null}
 */
function buildRowIfOverBudget(field, measurement, formFactor) {
  if (!measurement) return null;

  const maxWidthPx = serpPixelBudgetsRuleset[field].maxWidthPx[formFactor];
  if (measurement.widthPx <= maxWidthPx) return null;

  return {
    field,
    widthPx: Math.round(measurement.widthPx * 100) / 100,
    maxWidthPx,
    text: measurement.text,
  };
}

// @ts-expect-error - PixelWidth isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in structured-data-json-ld.js and
// structured-data-schema-properties.js.
class PixelWidthTruncation extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'pixel-width-truncation',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['PixelWidth'],
    };
  }

  /**
   * @param {{PixelWidth: import('../gatherers/pixel-width.js').PixelWidthArtifact}} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts, context) {
    const {title, description} = artifacts.PixelWidth;

    if (!title && !description) {
      return {score: null, notApplicable: true};
    }

    // Confirmed real, already-used pattern (e.g. largest-contentful-paint-element.js) — not
    // guessed. Only the pixel budget is form-factor-dependent; font is treated as
    // device-independent (see docs/audit-specs/pixel-width-truncation.md).
    const formFactor = context.settings.formFactor === 'mobile' ? 'mobile' : 'desktop';

    const rows = [
      buildRowIfOverBudget('title', title, formFactor),
      buildRowIfOverBudget('description', description, formFactor),
    ].filter(/** @return {row is PixelWidthRow} */ row => row !== null);

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'field', valueType: 'text', label: 'Field'},
      {key: 'widthPx', valueType: 'numeric', label: 'Rendered width (px)'},
      {key: 'maxWidthPx', valueType: 'numeric', label: 'Approximate budget (px)'},
      {key: 'text', valueType: 'text', label: 'Text'},
    ];

    const details = Audit.makeTableDetails(headings, rows);
    // @ts-expect-error - rulesetVersions isn't part of Lighthouse's Details.Table type — see the
    // sibling structured-data audits for the same reproducibility-stamp rationale.
    details.rulesetVersions = {serpPixelBudgets: serpPixelBudgetsRuleset.version};

    return {
      score: null,
      details,
    };
  }
}

export default PixelWidthTruncation;
export {UIStrings};
