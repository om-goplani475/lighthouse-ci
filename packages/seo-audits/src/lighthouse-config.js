/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Custom Lighthouse config consumers reference via .lighthouserc.js's `configPath`
 * setting (a first-class Lighthouse setting — see docs/configuration.md). Adds the
 * structured-data-json-ld, structured-data-schema-properties,
 * structured-data-rich-result-eligibility, structured-data-type-conflicts,
 * pixel-width-truncation, and meta-description-identical-to-title gatherer/audits on top of
 * Lighthouse's default set.
 *
 * Paths below are plain relative strings, not require.resolve() calls: this file is
 * ESM (no bare `require`), and Lighthouse's own module resolver
 * (core/config/config-helpers.js's resolveModulePath) already resolves relative paths
 * against this config file's own directory natively — no extra resolution needed.
 *
 * `extends: 'lighthouse:default'` is required — omitting it would replace Lighthouse's
 * entire default audit/category set instead of adding to it. See
 * test/lighthouse-config.test.js for the regression test that catches this if dropped.
 */

/** @type {import('lighthouse/types/config.js').default} */
const config = {
  extends: 'lighthouse:default',
  artifacts: [
    {id: 'StructuredDataJsonLd', gatherer: './gatherers/structured-data-json-ld.js'},
    {id: 'PixelWidth', gatherer: './gatherers/pixel-width.js'},
  ],
  audits: [
    './audits/structured-data-json-ld.js',
    './audits/structured-data-schema-properties.js',
    './audits/structured-data-rich-result-eligibility.js',
    './audits/structured-data-type-conflicts.js',
    './audits/pixel-width-truncation.js',
    './audits/meta-description-identical-to-title.js',
  ],
  categories: {
    'seo-extended': {
      title: 'Extended SEO (fork)',
      auditRefs: [
        {id: 'structured-data-json-ld', weight: 1},
        {id: 'structured-data-schema-properties', weight: 1},
        {id: 'structured-data-rich-result-eligibility', weight: 1},
        {id: 'structured-data-type-conflicts', weight: 1},
        {id: 'pixel-width-truncation', weight: 1},
        {id: 'meta-description-identical-to-title', weight: 1},
      ],
    },
  },
};

export default config;
