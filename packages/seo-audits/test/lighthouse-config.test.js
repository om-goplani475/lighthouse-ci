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

    // And all thirty-eight of this fork's audits are actually added, not just defaults preserved.
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
  }, 30000);

  it('has no audit id with a hyphen followed by a digit', async () => {
    // `lhci assert` expands a hyphenated assertion key into a camelCase alias and drops the alias by
    // comparing against a kebab-case conversion that puts no hyphen before digits. For an id such as
    // `soft-404` the alias `soft404` is not recognised as a duplicate, so it is asserted as an unknown
    // audit and every `lhci assert` run fails, whatever the audit scored (found in live QA).
    const {auditIds} = await resolveConfig();
    expect(auditIds.filter(id => /-\d/.test(id))).toEqual([]);
  }, 30000);

  it('adds the seo-extended category with all thirty-eight audits, without touching the core seo category', async () => {
    const {categories} = await resolveConfig();

    expect(categories['seo-extended']).toBeDefined();
    expect(categories['seo-extended'].auditRefs.map(ref => ref.id).sort()).toEqual([
      'canonical-https',
      'document-h1-count',
      'document-title-quality',
      'favicon-presence',
      'favicon-quality',
      'h1-title-relevance',
      'hsts-quality',
      'llms-txt-structure',
      'manifest-icons',
      'meta-description-identical-to-title',
      'mixed-content',
      'open-graph-canonical-match',
      'open-graph-completeness',
      'open-graph-image-reachable',
      'pixel-width-truncation',
      'redirect-chain-length',
      'redirect-loop',
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
      'twitter-card-completeness',
      'url-variant-consistency',
    ]);
    expect(categories['seo']).toBeDefined();
  }, 30000);
});
