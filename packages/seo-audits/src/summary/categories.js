/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which summary category each audit belongs to. Data, not logic: a test keeps it in step with the audits (every audit
 * in `lighthouse-config.js` appears exactly once).
 */

/** @type {Array<{name: string, audits: string[]}>} */
const CATEGORIES = [
  {
    name: 'Page metadata',
    audits: [
      'document-title-quality',
      'document-h1-count',
      'meta-description-identical-to-title',
      'h1-title-relevance',
      'pixel-width-truncation',
      'favicon-presence',
      'favicon-quality',
      'manifest-icons',
      'canonical-https',
    ],
  },
  {
    name: 'Structured data',
    audits: [
      'structured-data-json-ld',
      'structured-data-schema-properties',
      'structured-data-type-conflicts',
      'structured-data-rich-result-eligibility',
      'structured-data-deprecated-properties',
    ],
  },
  {
    name: 'Social sharing',
    audits: [
      'open-graph-completeness',
      'open-graph-canonical-match',
      'open-graph-image-reachable',
      'twitter-card-completeness',
      'social-preview-content',
    ],
  },
  {
    name: 'Robots and sitemaps',
    audits: [
      'robots-txt-crawler-access',
      'robots-txt-sitemap-declared',
      'robots-txt-rule-conflicts',
      'sitemap-valid',
      'sitemap-duplicate-urls',
      'sitemap-limits',
      'sitemap-url-status',
      'sitemap-robots-crossref',
      'sitemap-indexability',
      'llms-txt-structure',
    ],
  },
  {
    name: 'Crawlability and indexability',
    audits: [
      'mixed-content',
      'hsts-quality',
      'ssl-certificate-expiry',
      'soft-not-found',
      'url-variant-consistency',
      'redirect-chain-length',
      'redirect-loop',
      'indexability-verdict',
      'indexability-conflicts',
      'robots-directives-report',
      'robots-directives-conflict',
      'canonical-conflicts',
    ],
  },
  {
    name: 'Duplicates and coverage',
    audits: [
      'duplicate-titles',
      'duplicate-descriptions',
      'duplicate-content',
      'thin-content',
      'crawl-coverage',
    ],
  },
  {
    name: 'Internal linking',
    audits: [
      'dead-end-pages',
      'internal-link-counts',
      'orphan-pages',
      'crawl-depth',
      'broken-internal-links',
      'redirecting-internal-links',
      'internal-redirect-chains',
      'anchor-text-diversity',
      'descriptive-anchor-text',
      'pagination-links',
      'paginated-canonical',
      'pagination-trap',
      'broken-external-links',
    ],
  },
  {
    name: 'URL quality',
    audits: [
      'url-length',
      'url-query-parameters',
      'url-session-tracking',
      'url-encoding',
      'url-case-variants',
      'url-trailing-slash-variants',
      'url-normalization',
    ],
  },
  {
    name: 'Images',
    audits: [
      'image-alt-quality',
      'image-filename-quality',
      'image-lazy-above-fold',
      'image-dimensions-attributes',
      'image-oversized',
      'image-legacy-formats',
      'broken-images',
    ],
  },
  {
    name: 'International (hreflang)',
    audits: [
      'hreflang-codes',
      'hreflang-return-links',
      'hreflang-alternate-status',
      'hreflang-canonical',
      'hreflang-x-default',
      'hreflang-sitemap-consistency',
      'hreflang-locale-meta',
    ],
  },
  {
    name: 'Rendering and performance',
    audits: [
      'js-head-signals',
      'js-internal-links',
      'js-visible-content',
      'raw-rendered-diff',
      'rendering-mode',
      'hydration-errors',
      'device-content-parity',
      'core-web-vitals-field',
      'render-blocking-report',
      'request-weight-report',
    ],
  },
  {
    name: 'Content and AI search',
    audits: [
      'placeholder-content',
      'content-dates',
      'readability-score',
      'hidden-text',
      'keyword-alignment',
      'ai-crawler-summary',
      'answer-structure',
      'author-entity-signals',
      'amp-check',
    ],
  },
  {
    name: 'Security headers',
    audits: ['x-content-type-options', 'referrer-policy', 'content-security-policy-report'],
  },
  {
    name: 'E-commerce',
    audits: [
      'product-identifiers',
      'product-offer-values',
      'product-variants',
      'faceted-navigation-explosion',
      'product-pages-in-sitemap',
      'product-category-linking',
    ],
  },
  {
    name: 'Local business',
    audits: [
      'local-business-values',
      'local-nap-consistency',
      'local-name-consistency',
      'local-pages-report',
      'local-pages-in-sitemap',
    ],
  },
  {
    name: 'News',
    audits: [
      'article-values',
      'news-sitemap-valid',
      'news-sitemap-freshness',
      'news-sitemap-report',
    ],
  },
];

/**
 * @param {string} auditId
 * @return {string | null} The category name, or null for an audit that is not mapped.
 */
function categoryOf(auditId) {
  for (const category of CATEGORIES) {
    if (category.audits.includes(auditId)) return category.name;
  }
  return null;
}

export {CATEGORIES, categoryOf};
