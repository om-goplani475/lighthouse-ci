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

const AUDIT_PATH = path.join(__dirname, '../../src/audits/structured-data-schema-properties.js');

const DRIVER_SCRIPT = `
import {readFileSync} from 'fs';
const {default: Audit} = await import(process.argv[2]);
const artifacts = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
console.log(JSON.stringify(Audit.audit(artifacts)));
`;

/**
 * Same shell-out-via-temp-files pattern as structured-data-json-ld.test.js, for the same
 * reason: this audit transitively imports rule-engine/registry.js, which uses
 * `import.meta.url` at module scope and cannot be loaded directly inside Jest under this
 * repo's shared `module: "commonjs"` tsconfig.
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

const VALID_PRODUCT = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
  image: 'https://example.com/widget.jpg',
  offers: {price: '9.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
});

const PRODUCT_MISSING_AVAILABILITY = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
  image: 'https://example.com/widget.jpg',
  offers: {price: '9.99', priceCurrency: 'USD'},
});

const VALID_ARTICLE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Title',
  image: 'https://example.com/a.jpg',
  datePublished: '2026-09-28',
});

const ARTICLE_MISSING_DATE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Title',
  image: 'https://example.com/a.jpg',
});

describe('structured-data-schema-properties audit', () => {
  it('passes a Product with all required properties including nested offers', async () => {
    const result = await runAudit([{content: VALID_PRODUCT}]);
    expect(result.score).toBe(1);
  }, 30000);

  it('fails a Product missing a nested required property (offers.availability)', async () => {
    const result = await runAudit([{content: PRODUCT_MISSING_AVAILABILITY}]);
    expect(result.score).toBe(0);
    const failure = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'google-requirements'
    );
    expect(failure.property).toBe('offers.availability');
  }, 30000);

  it('passes an Article with all required flat properties', async () => {
    const result = await runAudit([{content: VALID_ARTICLE}]);
    expect(result.score).toBe(1);
  }, 30000);

  it('fails an Article missing a required flat property (datePublished)', async () => {
    const result = await runAudit([{content: ARTICLE_MISSING_DATE}]);
    expect(result.score).toBe(0);
    const failure = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'google-requirements'
    );
    expect(failure.property).toBe('datePublished');
  }, 30000);

  it('is not applicable when no block has a tracked type', async () => {
    const result = await runAudit([
      {content: JSON.stringify({'@context': 'https://schema.org', '@type': 'WebSite'})},
    ]);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  }, 30000);

  it('reports a hedged eligibility row alongside a passing Product, never affecting score', async () => {
    const result = await runAudit([{content: VALID_PRODUCT}]);
    expect(result.score).toBe(1);
    const eligibilityRow = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'eligibility'
    );
    expect(eligibilityRow).toBeDefined();
    expect(eligibilityRow.message).toContain('does not guarantee');
  }, 30000);

  it('stamps rulesetVersions for both namespaces into details for reproducibility', async () => {
    const result = await runAudit([{content: VALID_PRODUCT}]);
    expect(result.details.rulesetVersions).toEqual({
      googleStructuredData: '2026-09',
      eligibility: '2026-09',
    });
  }, 30000);
});
