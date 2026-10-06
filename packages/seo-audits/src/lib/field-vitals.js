/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `core-web-vitals-field` audit: the real-user Core Web Vitals CrUX holds for the
 * audited page, judged against Google's published thresholds. No I/O, never throws.
 *
 * Rules, chosen with the developer: Largest Contentful Paint, Interaction to Next Paint and Cumulative Layout
 * Shift are judged at the 75th percentile (the value Google uses). The audit fails only when one of them is
 * "poor" (LCP over 4 s, INP over 500 ms, CLS over 0.25). "Needs improvement" is shown, never failed. First
 * Contentful Paint and Time to First Byte are shown for information only. Missing data is "not applicable".
 * Data for the whole site (CrUX had none for this URL) describes other pages, so a poor site-wide result is shown
 * as a note and never fails this page.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/field-data.js').FieldDataArtifact} FieldDataArtifact */

/** Google's documented thresholds (web.dev/vitals); `judged` metrics can fail the audit. */
const THRESHOLDS = {
  lcp: {label: 'Largest Contentful Paint', good: 2500, poor: 4000, judged: true, unit: 'ms'},
  inp: {label: 'Interaction to Next Paint', good: 200, poor: 500, judged: true, unit: 'ms'},
  cls: {label: 'Cumulative Layout Shift', good: 0.1, poor: 0.25, judged: true, unit: ''},
  fcp: {label: 'First Contentful Paint', good: 1800, poor: 3000, judged: false, unit: 'ms'},
  ttfb: {label: 'Time to First Byte', good: 800, poor: 1800, judged: false, unit: 'ms'},
};

/**
 * @param {keyof typeof THRESHOLDS} key
 * @param {number} value
 * @return {string}
 */
function formatValue(key, value) {
  if (key === 'cls') return value.toFixed(2);
  return key === 'lcp' || key === 'fcp'
    ? `${(value / 1000).toFixed(1)} s`
    : `${Math.round(value)} ms`;
}

/**
 * @param {keyof typeof THRESHOLDS} key
 * @param {number} p75
 * @return {'good' | 'needs improvement' | 'poor'}
 */
function rate(key, p75) {
  const t = THRESHOLDS[key];
  return p75 <= t.good ? 'good' : p75 > t.poor ? 'poor' : 'needs improvement';
}

/**
 * @param {number | null | undefined} share
 * @return {string}
 */
function percent(share) {
  return typeof share === 'number' ? `${Math.round(share * 100)}%` : '';
}

/**
 * @param {FieldDataArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildFieldVitalsProduct(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return {score: 1, notApplicable: true, explanation: 'The field data was not collected.'};
  }
  if (artifact.state !== 'ok') {
    return {
      score: 1,
      notApplicable: true,
      explanation: artifact.reason || 'No field data is available for this page.',
    };
  }
  const metrics = artifact.metrics && typeof artifact.metrics === 'object' ? artifact.metrics : {};
  /** @type {Array<{metric: string, p75: string, result: string, good: string}>} */
  const rows = [];
  /** @type {string[]} */
  const poor = [];
  /** @type {string[]} */
  const needsWork = [];
  /** @type {string[]} */
  const summary = [];
  let judged = 0;
  for (const key of /** @type {Array<keyof typeof THRESHOLDS>} */ (Object.keys(THRESHOLDS))) {
    const m = metrics[key];
    if (!m || typeof m.p75 !== 'number') continue;
    const t = THRESHOLDS[key];
    const result = rate(key, m.p75);
    rows.push({
      metric: t.label + (t.judged ? '' : ' (not judged)'),
      p75: formatValue(key, m.p75),
      result,
      good: percent(m.good),
    });
    if (!t.judged) continue;
    judged++;
    summary.push(`${key.toUpperCase()} ${formatValue(key, m.p75)}`);
    if (result === 'poor') poor.push(`${t.label} ${formatValue(key, m.p75)}`);
    else if (result === 'needs improvement') needsWork.push(t.label);
  }
  if (judged === 0) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'CrUX returned none of LCP, INP or CLS for this page.',
    };
  }

  const where = `${
    artifact.source === 'origin' ? 'the whole site (no data for this URL)' : 'this URL'
  }, ${artifact.formFactor === 'DESKTOP' ? 'desktop' : 'phone'} visitors${
    artifact.collectionPeriod
      ? `, ${artifact.collectionPeriod.first} to ${artifact.collectionPeriod.last}`
      : ''
  }`;
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'metric', valueType: 'text', label: 'Metric (75th percentile)'},
    {key: 'p75', valueType: 'text', label: 'Value'},
    {key: 'result', valueType: 'text', label: 'Google rating'},
    {key: 'good', valueType: 'text', label: 'Visits rated good'},
  ];
  const details = Audit.makeTableDetails(headings, rows);
  const displayValue = `${summary.join(', ')} (${artifact.source === 'origin' ? 'site' : 'URL'}, ${
    artifact.formFactor === 'DESKTOP' ? 'desktop' : 'phone'
  })`;
  if (poor.length > 0 && artifact.source === 'origin') {
    rows.push({
      metric: 'Note',
      p75: '',
      result: `${poor.join(
        ' and '
      )} is poor across the site, but CrUX has no data for this URL, so this page is not failed`,
      good: '',
    });
    return {
      score: 1,
      displayValue: `${displayValue}; poor site-wide: ${poor.join(', ')} (not failed)`,
      details: Audit.makeTableDetails(headings, rows),
    };
  }
  if (poor.length > 0) {
    return {
      score: 0,
      displayValue,
      explanation: `Real visitors rate ${poor.join(
        ' and '
      )} as poor at the 75th percentile (${where}). Google uses this field data, not a lab test, for the Core Web Vitals signal. A lab fix shows up here only after about 28 days.`,
      details,
    };
  }
  return {
    score: 1,
    displayValue: needsWork.length
      ? `${displayValue}; needs improvement: ${needsWork.join(', ')}`
      : displayValue,
    details,
  };
}

export {buildFieldVitalsProduct, rate, THRESHOLDS};
