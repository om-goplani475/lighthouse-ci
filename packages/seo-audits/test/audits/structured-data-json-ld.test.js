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

const AUDIT_PATH = path.join(__dirname, '../../src/audits/structured-data-json-ld.js');

const DRIVER_SCRIPT = `
import {readFileSync} from 'fs';
const {default: Audit} = await import(process.argv[2]);
const artifacts = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
console.log(JSON.stringify(Audit.audit(artifacts)));
`;

/**
 * Since the migration onto the rule engine (see docs/task-sequences/structured-data-rule-engine.md
 * task-07), this audit transitively imports rule-engine/registry.js, which uses `import.meta.url`
 * at module scope. ts-jest cannot compile `import.meta` to this repo's shared `module: "commonjs"`
 * tsconfig target (a compile-time constraint — confirmed by the `@ts-expect-error` already needed
 * for the same reason at type-check time), so **any file that imports registry.js, even
 * transitively, can no longer be loaded directly inside the Jest process** — not just
 * registry.test.js. Shelling out to real node instead, same established pattern as
 * packages/utils/test/presets.test.js and packages/seo-audits/test/lighthouse-config.test.js.
 *
 * Data is passed via temp files, not string-interpolated into a shell command — JSON containing
 * quotes/backslashes (e.g. malformed-JSON test fixtures) does not survive multi-layer shell/JS
 * string escaping reliably; writing files and using execFile (no shell) avoids that entirely.
 * @param {Array<{content: string, node?: object}>} blocks
 * @return {Promise<any>}
 */
async function runAudit(blocks) {
  const artifacts = {
    StructuredDataJsonLd: blocks.map(b => ({content: b.content, node: b.node || {}})),
  };

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

describe('structured-data-json-ld audit', () => {
  it('passes a single valid block', async () => {
    const result = await runAudit([
      {content: '{"@context": "https://schema.org", "@type": "Article"}'},
    ]);
    expect(result.score).toBe(1);
  }, 30000);

  it('passes multiple valid blocks', async () => {
    const result = await runAudit([
      {content: '{"@context": "https://schema.org", "@type": "Article"}'},
      {content: '{"@context": "https://schema.org", "@type": "Organization"}'},
    ]);
    expect(result.score).toBe(1);
  }, 30000);

  it('is not applicable when the page has no JSON-LD (structured data is optional)', async () => {
    const result = await runAudit([]);
    expect(result.notApplicable).toBe(true);
  }, 30000);

  it('fails on malformed JSON', async () => {
    const result = await runAudit([{content: '{"@context": "https://schema.org", "@type": }'}]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].reason).toBe('Invalid JSON');
  }, 30000);

  it('fails valid JSON missing @context and @type', async () => {
    const result = await runAudit([{content: '{"headline": "No context or type here"}'}]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].reason).toBe('Missing @context or @type');
  }, 30000);

  it('fails and reports each block individually when one of several is invalid', async () => {
    const result = await runAudit([
      {content: '{"@context": "https://schema.org", "@type": "Article"}'},
      {content: 'not json at all'},
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items).toHaveLength(2);
    expect(result.details.items[0].valid).toBe('Yes');
    expect(result.details.items[1].valid).toBe('No');
    expect(result.details.items[1].reason).toBe('Invalid JSON');
  }, 30000);

  it('stamps rulesetVersions into details for reproducibility', async () => {
    const result = await runAudit([
      {content: '{"@context": "https://schema.org", "@type": "Article"}'},
    ]);
    expect(result.details.rulesetVersions).toEqual({schemaOrg: '2026-09'});
  }, 30000);

  it('passes a valid @graph container — the false positive this used to produce is fixed (Phase 2 item 5)', async () => {
    const result = await runAudit([
      {
        content: JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {'@type': 'Product', name: 'Widget'},
            {'@type': 'Organization', name: 'Acme'},
          ],
        }),
      },
    ]);
    expect(result.score).toBe(1);
  }, 30000);

  it('fails a @graph container with an entry missing its own @type', async () => {
    const result = await runAudit([
      {
        content: JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [{'@type': 'Product', name: 'Widget'}, {name: 'No type here'}],
        }),
      },
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].reason).toBe('Missing @context or @type');
  }, 30000);
  describe('a top-level array of objects (valid JSON-LD)', () => {
    const el = type => ({'@context': 'https://schema.org', '@type': type, name: 'x'});

    it('is valid when every element has @context and @type', async () => {
      const result = await runAudit([
        {content: JSON.stringify([el('ProductGroup'), el('Product')])},
      ]);
      expect(result.score).toBe(1);
      expect(result.details.items[0].valid).toBe('Yes');
    });

    it('is invalid when an element is not an object or lacks @type or @context', async () => {
      for (const bad of [
        [el('Product'), {'@context': 'https://schema.org', name: 'no type'}],
        [el('Product'), {'@type': 'Product', name: 'no context'}],
        [el('Product'), 42],
        [el('Product'), [el('Product')]],
        [],
      ]) {
        const result = await runAudit([{content: JSON.stringify(bad)}]);
        expect(result.score).toBe(0);
        expect(result.details.items[0].reason).toBe('Missing @context or @type');
      }
    });
  });
});
