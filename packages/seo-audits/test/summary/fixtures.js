/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small fake Lighthouse results for the summary tests.
 */

/** A pretend preset: two error-tier and two warn-tier audits, one in each of two categories. */
const RECOMMENDED = {
  'canonical-https': ['error', {minScore: 1}],
  'document-title-quality': ['warn', {minScore: 1}],
  'sitemap-valid': ['error', {minScore: 1}],
  'duplicate-titles': ['warn', {minScore: 1}],
};

/**
 * @param {number | null} score
 * @param {Record<string, any>} [over]
 */
const audit = (score, over = {}) => ({
  title: 'An audit',
  description: 'About this audit, with a [link](https://example.com).',
  score,
  scoreDisplayMode: score === null ? 'notApplicable' : 'binary',
  displayValue: score === 1 ? '' : 'something is wrong',
  ...over,
});

/**
 * @param {Record<string, any>} audits
 * @param {{url?: string, fetchTime?: string}} [opts]
 */
const lhr = (
  audits,
  {url = 'https://example.com/', fetchTime = '2026-10-06T10:00:00.000Z'} = {}
) => ({
  finalDisplayedUrl: url,
  fetchTime,
  lighthouseVersion: '12.6.1',
  audits,
});

module.exports = {RECOMMENDED, audit, lhr};
