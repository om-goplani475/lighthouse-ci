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
    const {auditIds} = await resolveConfig();

    // Core defaults must still be present — this is what would fail if a future
    // edit accidentally dropped `extends: 'lighthouse:default'`.
    expect(auditIds).toContain('meta-description');
    expect(auditIds).toContain('document-title');

    // And all nine of this fork's audits are actually added, not just defaults preserved.
    expect(auditIds).toContain('structured-data-json-ld');
    expect(auditIds).toContain('structured-data-schema-properties');
    expect(auditIds).toContain('structured-data-rich-result-eligibility');
    expect(auditIds).toContain('structured-data-type-conflicts');
    expect(auditIds).toContain('pixel-width-truncation');
    expect(auditIds).toContain('meta-description-identical-to-title');
    expect(auditIds).toContain('document-title-quality');
    expect(auditIds).toContain('document-h1-count');
    expect(auditIds).toContain('h1-title-relevance');
  }, 30000);

  it('adds the seo-extended category with all nine audits, without touching the core seo category', async () => {
    const {categories} = await resolveConfig();

    expect(categories['seo-extended']).toBeDefined();
    expect(categories['seo-extended'].auditRefs.map(ref => ref.id).sort()).toEqual([
      'document-h1-count',
      'document-title-quality',
      'h1-title-relevance',
      'meta-description-identical-to-title',
      'pixel-width-truncation',
      'structured-data-json-ld',
      'structured-data-rich-result-eligibility',
      'structured-data-schema-properties',
      'structured-data-type-conflicts',
    ]);
    expect(categories['seo']).toBeDefined();
  }, 30000);
});
