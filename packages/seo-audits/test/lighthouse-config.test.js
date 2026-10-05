/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const path = require('path');
const {promisify} = require('util');
const {exec} = require('child_process');

const execAsync = promisify(exec);

const CONFIG_PATH = path.join(__dirname, '../src/lighthouse-config.js');

/**
 * Jest does a bad job with esm (see packages/utils/test/presets.test.js for the same
 * workaround) — importing `lighthouse` directly inside the Jest process hits
 * `import.meta` in a file Jest's transform won't touch. Shell out instead.
 * @return {Promise<{resolvedConfig: any}>}
 */
async function resolveConfig() {
  const script = `
    import {initializeConfig} from 'lighthouse/core/config/config.js';
    import config from '${CONFIG_PATH}';
    // configDir (needed to resolve the gatherer/audit relative paths inside
    // lighthouse-config.js) is derived from flags.configPath, not from wherever this
    // script imported the config object from — see config.js's resolveWorkingCopy.
    initializeConfig('navigation', config, {configPath: '${CONFIG_PATH}'}).then(({resolvedConfig}) => {
      console.log(JSON.stringify({
        auditIds: (resolvedConfig.audits || []).map(a => a.implementation.meta.id),
        artifactIds: (resolvedConfig.artifacts || []).map(a => a.id),
        categories: resolvedConfig.categories,
      }));
    });
  `;
  const {stdout} = await execAsync(`node --input-type=module -e "${script.replace(/"/g, '\\"')}"`);
  return JSON.parse(stdout);
}

/**
 * Regression test for the "Resolved for Agent 04" item in
 * docs/audit-specs/structured-data-validation.md: `extends: 'lighthouse:default'`
 * must be preserved, so adding this audit is additive, not a replacement of
 * Lighthouse's default audit/category set.
 */
describe('seo-audits lighthouse-config', () => {
  it('preserves core default audits alongside the new one', async () => {
    const {auditIds, artifactIds} = await resolveConfig();

    // Core defaults must still be present — this is what would fail if a future
    // edit accidentally dropped `extends: 'lighthouse:default'`.
    expect(auditIds).toContain('meta-description');
    expect(auditIds).toContain('document-title');

    // The gatherer the sitemap audits depend on must resolve too, or they would all error.
    expect(artifactIds).toContain('SitemapDocuments');
    expect(artifactIds).toContain('LlmsTxt');
    expect(artifactIds).toContain('Soft404Probe');
    expect(artifactIds).toContain('UrlVariants');
    expect(artifactIds).toContain('IndexabilitySignals');
    expect(artifactIds).toContain('SiteCrawl');

    // And all fifty-nine of this fork's audits are actually added, not just defaults preserved.
    expect(auditIds).toContain('structured-data-json-ld');
    expect(auditIds).toContain('structured-data-schema-properties');
    expect(auditIds).toContain('structured-data-rich-result-eligibility');
    expect(auditIds).toContain('structured-data-type-conflicts');
    expect(auditIds).toContain('structured-data-deprecated-properties');
    expect(auditIds).toContain('pixel-width-truncation');
    expect(auditIds).toContain('meta-description-identical-to-title');
    expect(auditIds).toContain('document-title-quality');
    expect(auditIds).toContain('document-h1-count');
    expect(auditIds).toContain('h1-title-relevance');
    expect(auditIds).toContain('robots-directives-report');
    expect(auditIds).toContain('robots-directives-conflict');
    expect(auditIds).toContain('canonical-https');
    expect(auditIds).toContain('favicon-presence');
    expect(auditIds).toContain('favicon-quality');
    expect(auditIds).toContain('manifest-icons');
    expect(auditIds).toContain('open-graph-completeness');
    expect(auditIds).toContain('open-graph-canonical-match');
    expect(auditIds).toContain('open-graph-image-reachable');
    expect(auditIds).toContain('twitter-card-completeness');
    expect(auditIds).toContain('social-preview-content');
    expect(auditIds).toContain('robots-txt-sitemap-declared');
    expect(auditIds).toContain('robots-txt-crawler-access');
    expect(auditIds).toContain('robots-txt-rule-conflicts');
    expect(auditIds).toContain('sitemap-valid');
    expect(auditIds).toContain('sitemap-duplicate-urls');
    expect(auditIds).toContain('sitemap-limits');
    expect(auditIds).toContain('sitemap-url-status');
    expect(auditIds).toContain('sitemap-robots-crossref');
    expect(auditIds).toContain('sitemap-indexability');
    expect(auditIds).toContain('llms-txt-structure');
    expect(auditIds).toContain('mixed-content');
    expect(auditIds).toContain('hsts-quality');
    expect(auditIds).toContain('ssl-certificate-expiry');
    expect(auditIds).toContain('soft-not-found');
    expect(auditIds).toContain('url-variant-consistency');
    expect(auditIds).toContain('redirect-chain-length');
    expect(auditIds).toContain('redirect-loop');
    expect(auditIds).toContain('indexability-verdict');
    expect(auditIds).toContain('indexability-conflicts');
    expect(auditIds).toContain('crawl-coverage');
    expect(auditIds).toContain('duplicate-titles');
    expect(auditIds).toContain('duplicate-descriptions');
    expect(auditIds).toContain('thin-content');
    expect(auditIds).toContain('canonical-conflicts');
    expect(auditIds).toContain('duplicate-content');
    expect(auditIds).toContain('dead-end-pages');
    expect(auditIds).toContain('internal-link-counts');
    expect(auditIds).toContain('orphan-pages');
    expect(auditIds).toContain('crawl-depth');
    expect(auditIds).toContain('broken-internal-links');
    expect(auditIds).toContain('redirecting-internal-links');
    expect(auditIds).toContain('internal-redirect-chains');
    expect(auditIds).toContain('anchor-text-diversity');
    expect(auditIds).toContain('descriptive-anchor-text');
    expect(auditIds).toContain('pagination-links');
    expect(auditIds).toContain('paginated-canonical');
    expect(auditIds).toContain('pagination-trap');
    expect(auditIds).toContain('broken-external-links');
    expect(auditIds).toContain('js-head-signals');
    expect(auditIds).toContain('js-internal-links');
    expect(auditIds).toContain('js-visible-content');
    expect(auditIds).toContain('raw-rendered-diff');
    expect(auditIds).toContain('rendering-mode');
    expect(auditIds).toContain('hydration-errors');
    expect(auditIds).toContain('device-content-parity');
    expect(auditIds).toContain('image-alt-quality');
    expect(auditIds).toContain('image-filename-quality');
    expect(auditIds).toContain('image-lazy-above-fold');
    expect(auditIds).toContain('image-dimensions-attributes');
    expect(auditIds).toContain('image-oversized');
    expect(auditIds).toContain('image-legacy-formats');
    expect(auditIds).toContain('broken-images');
    expect(auditIds).toContain('url-length');
    expect(auditIds).toContain('url-query-parameters');
    expect(auditIds).toContain('url-session-tracking');
    expect(auditIds).toContain('url-encoding');
    expect(auditIds).toContain('url-case-variants');
    expect(auditIds).toContain('url-trailing-slash-variants');
    expect(auditIds).toContain('url-normalization');
  }, 30000);

  it('has no audit id with a hyphen followed by a digit', async () => {
    // `lhci assert` expands a hyphenated assertion key into a camelCase alias and drops the alias by
    // comparing against a kebab-case conversion that puts no hyphen before digits. For an id such as
    // `soft-404` the alias `soft404` is not recognised as a duplicate, so it is asserted as an unknown
    // audit and every `lhci assert` run fails, whatever the audit scored (found in live QA).
    const {auditIds} = await resolveConfig();
    expect(auditIds.filter(id => /-\d/.test(id))).toEqual([]);
  }, 30000);

  it('adds the seo-extended category with all fifty-nine audits, without touching the core seo category', async () => {
    const {categories} = await resolveConfig();

    expect(categories['seo-extended']).toBeDefined();
    expect(categories['seo-extended'].auditRefs.map(ref => ref.id).sort()).toEqual([
      'anchor-text-diversity',
      'broken-external-links',
      'broken-images',
      'broken-internal-links',
      'canonical-conflicts',
      'canonical-https',
      'crawl-coverage',
      'crawl-depth',
      'dead-end-pages',
      'descriptive-anchor-text',
      'device-content-parity',
      'document-h1-count',
      'document-title-quality',
      'duplicate-content',
      'duplicate-descriptions',
      'duplicate-titles',
      'favicon-presence',
      'favicon-quality',
      'h1-title-relevance',
      'hsts-quality',
      'hydration-errors',
      'image-alt-quality',
      'image-dimensions-attributes',
      'image-filename-quality',
      'image-lazy-above-fold',
      'image-legacy-formats',
      'image-oversized',
      'indexability-conflicts',
      'indexability-verdict',
      'internal-link-counts',
      'internal-redirect-chains',
      'js-head-signals',
      'js-internal-links',
      'js-visible-content',
      'llms-txt-structure',
      'manifest-icons',
      'meta-description-identical-to-title',
      'mixed-content',
      'open-graph-canonical-match',
      'open-graph-completeness',
      'open-graph-image-reachable',
      'orphan-pages',
      'paginated-canonical',
      'pagination-links',
      'pagination-trap',
      'pixel-width-truncation',
      'raw-rendered-diff',
      'redirect-chain-length',
      'redirect-loop',
      'redirecting-internal-links',
      'rendering-mode',
      'robots-directives-conflict',
      'robots-directives-report',
      'robots-txt-crawler-access',
      'robots-txt-rule-conflicts',
      'robots-txt-sitemap-declared',
      'sitemap-duplicate-urls',
      'sitemap-indexability',
      'sitemap-limits',
      'sitemap-robots-crossref',
      'sitemap-url-status',
      'sitemap-valid',
      'social-preview-content',
      'soft-not-found',
      'ssl-certificate-expiry',
      'structured-data-deprecated-properties',
      'structured-data-json-ld',
      'structured-data-rich-result-eligibility',
      'structured-data-schema-properties',
      'structured-data-type-conflicts',
      'thin-content',
      'twitter-card-completeness',
      'url-case-variants',
      'url-encoding',
      'url-length',
      'url-normalization',
      'url-query-parameters',
      'url-session-tracking',
      'url-trailing-slash-variants',
      'url-variant-consistency',
    ]);
    expect(categories['seo']).toBeDefined();
  }, 30000);
});
