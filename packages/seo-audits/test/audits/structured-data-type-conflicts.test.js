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

const AUDIT_PATH = path.join(__dirname, '../../src/audits/structured-data-type-conflicts.js');

const DRIVER_SCRIPT = `
import {readFileSync} from 'fs';
const {default: Audit} = await import(process.argv[2]);
const artifacts = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
console.log(JSON.stringify(Audit.audit(artifacts)));
`;

/**
 * Same shell-out-via-temp-files pattern as the other audits' tests: this audit transitively
 * imports rule-engine/registry.js, which uses `import.meta.url` at module scope and cannot be
 * loaded directly inside Jest under this repo's shared `module: "commonjs"` tsconfig.
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

const ORG_A = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'A',
});
const ORG_B = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'B',
});

const PRODUCT_SAME_SKU_DIFFERENT_PRICE_1 = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  sku: 'ABC',
  price: '9.99',
});
const PRODUCT_SAME_SKU_DIFFERENT_PRICE_2 = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  sku: 'ABC',
  price: '14.99',
});

const PRODUCT_DIFFERENT_SKU_1 = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  sku: 'AAA',
  name: 'Widget',
});
const PRODUCT_DIFFERENT_SKU_2 = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  sku: 'BBB',
  name: 'Gadget',
});

const PRODUCT_NO_IDENTITY_FIELD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Mystery item',
});

describe('structured-data-type-conflicts audit', () => {
  it('is not applicable when no block has a singular-type or identity-bearing type', () => {
    return runAudit([
      {content: JSON.stringify({'@context': 'https://schema.org', '@type': 'Review', author: 'A'})},
    ]).then(result => {
      expect(result.score).toBeNull();
      expect(result.notApplicable).toBe(true);
    });
  }, 30000);

  it('scores 1 with no findings on a clean page', async () => {
    const result = await runAudit([{content: ORG_A}]);
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([]);
  }, 30000);

  it('fails and reports a duplicate-count finding when a singular type appears twice', async () => {
    const result = await runAudit([{content: ORG_A}, {content: ORG_B}]);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      expect.objectContaining({namespace: 'duplicate-count', type: 'Organization'}),
    ]);
  }, 30000);

  it('reports a conflicting-entity finding without affecting score, for blocks sharing an identity field', async () => {
    const result = await runAudit([
      {content: PRODUCT_SAME_SKU_DIFFERENT_PRICE_1},
      {content: PRODUCT_SAME_SKU_DIFFERENT_PRICE_2},
    ]);
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([
      expect.objectContaining({namespace: 'conflicting-entity', type: 'Product', detail: 'price'}),
    ]);
  }, 30000);

  it('does not flag two Product blocks with different sku values as a conflict (legitimately different entities)', async () => {
    const result = await runAudit([
      {content: PRODUCT_DIFFERENT_SKU_1},
      {content: PRODUCT_DIFFERENT_SKU_2},
    ]);
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([]);
  }, 30000);

  it('never flags a block with no identity field, even against a matching-price block', async () => {
    const result = await runAudit([
      {content: PRODUCT_SAME_SKU_DIFFERENT_PRICE_1},
      {content: PRODUCT_NO_IDENTITY_FIELD},
    ]);
    expect(result.details.items.filter(i => i.namespace === 'conflicting-entity')).toEqual([]);
  }, 30000);

  it('stamps rulesetVersions for the type-conflicts namespace', async () => {
    const result = await runAudit([{content: ORG_A}, {content: ORG_B}]);
    expect(result.details.rulesetVersions).toEqual({typeConflicts: '2026-10'});
  }, 30000);

  it('does not crash or misbehave on a page with "@type": "__proto__" (security regression)', async () => {
    const protoBlock = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': '__proto__',
      x: 'y',
    });
    const result = await runAudit([{content: protoBlock}, {content: ORG_A}]);
    // "__proto__" isn't a tracked type, so it's simply ignored — Organization alone is clean.
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([]);
  }, 30000);

  it('both a real duplicate and a real conflict can be reported together on one page', async () => {
    const result = await runAudit([
      {content: ORG_A},
      {content: ORG_B},
      {content: PRODUCT_SAME_SKU_DIFFERENT_PRICE_1},
      {content: PRODUCT_SAME_SKU_DIFFERENT_PRICE_2},
    ]);
    expect(result.score).toBe(0);
    const namespaces = result.details.items.map(i => i.namespace).sort();
    expect(namespaces).toEqual(['conflicting-entity', 'duplicate-count']);
  }, 30000);

  it('detects a duplicate singular type declared twice within one @graph block (Phase 2 item 5)', async () => {
    const graphBlock = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [JSON.parse(ORG_A), JSON.parse(ORG_B)],
    });
    const result = await runAudit([{content: graphBlock}]);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      expect.objectContaining({namespace: 'duplicate-count', type: 'Organization'}),
    ]);
  }, 30000);
});
