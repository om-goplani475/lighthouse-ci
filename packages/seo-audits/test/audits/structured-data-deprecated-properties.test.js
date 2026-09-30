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
  '../../src/audits/structured-data-deprecated-properties.js'
);

const DRIVER_SCRIPT = `
import {readFileSync} from 'fs';
const {default: Audit} = await import(process.argv[2]);
const artifacts = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
const result = Audit.audit(artifacts);
console.log(JSON.stringify({...result, scoreDisplayMode: Audit.meta.scoreDisplayMode}));
`;

/**
 * Same shell-out-via-temp-files pattern as the sibling structured-data audits' tests: this
 * audit transitively imports rule-engine/registry.js, which uses `import.meta.url` at module
 * scope and cannot be loaded directly inside Jest under this repo's shared `module: "commonjs"`
 * tsconfig.
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

const PRODUCT_CLEAN = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
  review: {'@type': 'Review', reviewBody: 'Great'},
});

const PRODUCT_DEPRECATED = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
  reviews: [{'@type': 'Review', reviewBody: 'Great'}],
});

const WEBSITE_BLOCK = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Example',
});

describe('structured-data-deprecated-properties audit', () => {
  it('is not applicable when there is no JSON-LD of a tracked type at all', async () => {
    const result = await runAudit([{content: WEBSITE_BLOCK}]);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  }, 30000);

  it('reports zero rows for a tracked type using only current property names', async () => {
    const result = await runAudit([{content: PRODUCT_CLEAN}]);
    expect(result.notApplicable).toBeFalsy();
    expect(result.details.items).toEqual([]);
  }, 30000);

  it('flags a deprecated property on a tracked type, naming block/type/property/message', async () => {
    const result = await runAudit([{content: PRODUCT_DEPRECATED}]);
    expect(result.details.items).toEqual([
      expect.objectContaining({
        blockIndex: 0,
        type: 'Product',
        property: 'reviews',
      }),
    ]);
    expect(result.details.items[0].message).toContain('use "review" instead');
  }, 30000);

  it('is purely informational — score is always null, scoreDisplayMode is informative', async () => {
    const result = await runAudit([{content: PRODUCT_DEPRECATED}]);
    expect(result.score).toBeNull();
    expect(result.scoreDisplayMode).toBe('informative');
  }, 30000);

  it('stamps rulesetVersions for the schemaOrgDeprecations namespace', async () => {
    const result = await runAudit([{content: PRODUCT_CLEAN}]);
    expect(result.details.rulesetVersions).toEqual({schemaOrgDeprecations: '2026-10'});
  }, 30000);

  it('unwraps @graph and flags deprecated properties on each entity inside it', async () => {
    const graphBlock = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [JSON.parse(PRODUCT_DEPRECATED), JSON.parse(PRODUCT_CLEAN)],
    });
    const result = await runAudit([{content: graphBlock}]);
    expect(result.details.items).toEqual([
      expect.objectContaining({type: 'Product', property: 'reviews'}),
    ]);
  }, 30000);
});
