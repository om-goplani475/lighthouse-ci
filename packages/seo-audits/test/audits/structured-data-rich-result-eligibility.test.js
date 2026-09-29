/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const path = require('path');
const fs = require('fs');
const os = require('os');
const {promisify} = require('util');
const {execFile} = require('child_process');

const execFileAsync = promisify(execFile);

const AUDIT_PATH = path.join(
  __dirname,
  '../../src/audits/structured-data-rich-result-eligibility.js'
);

const DRIVER_SCRIPT = `
import {readFileSync} from 'fs';
const {default: Audit} = await import(process.argv[2]);
const artifacts = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
const result = Audit.audit(artifacts);
console.log(JSON.stringify({...result, scoreDisplayMode: Audit.meta.scoreDisplayMode}));
`;

/**
 * Same shell-out-via-temp-files pattern as the other two audits' tests: this audit
 * transitively imports rule-engine/registry.js, which uses `import.meta.url` at module
 * scope and cannot be loaded directly inside Jest under this repo's shared
 * `module: "commonjs"` tsconfig.
 * @param {Array<{content: string}>} blocks
 * @return {Promise<any>}
 */
async function runAudit(blocks) {
  const artifacts = {StructuredDataJsonLd: blocks.map(b => ({content: b.content, node: {}}))};

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-audits-test-'));
  const artifactsPath = path.join(tmpDir, 'artifacts.json');
  const driverPath = path.join(tmpDir, 'driver.mjs');
  fs.writeFileSync(artifactsPath, JSON.stringify(artifacts));
  fs.writeFileSync(driverPath, DRIVER_SCRIPT);

  try {
    const {stdout} = await execFileAsync('node', [driverPath, AUDIT_PATH, artifactsPath]);
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
}

const PRODUCT_BLOCK = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
});

const RECIPE_BLOCK = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Soup',
});

const WEBSITE_BLOCK = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Example',
});

const FAQ_PAGE_BLOCK = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [],
});

describe('structured-data-rich-result-eligibility audit', () => {
  it('reports one row per distinct tracked type found, in first-appearance order', async () => {
    const result = await runAudit([{content: PRODUCT_BLOCK}, {content: RECIPE_BLOCK}]);
    expect(result.details.items).toEqual([
      expect.objectContaining({type: 'Product', count: 1, tracked: 'Yes'}),
      expect.objectContaining({type: 'Recipe', count: 1, tracked: 'Yes'}),
    ]);
  }, 30000);

  it('collapses multiple blocks of the same type into one row with an incremented count', async () => {
    const result = await runAudit([{content: PRODUCT_BLOCK}, {content: PRODUCT_BLOCK}]);
    expect(result.details.items).toHaveLength(1);
    expect(result.details.items[0]).toEqual(
      expect.objectContaining({type: 'Product', count: 2, tracked: 'Yes'})
    );
  }, 30000);

  it('reports an untracked type as its own row, not a silent skip', async () => {
    const result = await runAudit([{content: WEBSITE_BLOCK}]);
    expect(result.details.items).toEqual([
      expect.objectContaining({
        type: 'WebSite',
        count: 1,
        tracked: 'No',
        richResultFeature: '',
      }),
    ]);
    expect(result.details.items[0].message).toContain(
      'not a rich-result type Google currently documents guidance for'
    );
  }, 30000);

  it('reports FAQPage as tracked but not eligible — tracked and supported are distinct concepts', async () => {
    const result = await runAudit([{content: FAQ_PAGE_BLOCK}]);
    expect(result.details.items).toEqual([
      expect.objectContaining({type: 'FAQPage', tracked: 'Yes'}),
    ]);
    expect(result.details.items[0].message).toContain('not currently documented as supported');
  }, 30000);

  it('is not applicable when there is zero parseable JSON-LD at all', async () => {
    const result = await runAudit([{content: 'not json'}]);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  }, 30000);

  it('is NOT not-applicable when JSON-LD exists but every type is untracked', async () => {
    const result = await runAudit([{content: WEBSITE_BLOCK}]);
    expect(result.notApplicable).toBeFalsy();
    expect(result.details).toBeDefined();
    expect(result.details.items).toHaveLength(1);
  }, 30000);

  it('is purely informational — score is always null, scoreDisplayMode is informative', async () => {
    const result = await runAudit([{content: PRODUCT_BLOCK}]);
    expect(result.score).toBeNull();
    expect(result.scoreDisplayMode).toBe('informative');
  }, 30000);

  it('stamps rulesetVersions for the eligibility namespace only', async () => {
    const result = await runAudit([{content: PRODUCT_BLOCK}]);
    expect(result.details.rulesetVersions).toEqual({eligibility: '2026-10'});
  }, 30000);
});
