/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const recommended = require('../src/recommended-assertions.json');

const path = require('path');
const {promisify} = require('util');
const {exec} = require('child_process');

const execAsync = promisify(exec);
const CONFIG_PATH = path.join(__dirname, '../src/lighthouse-config.js');

/**
 * Jest cannot import the ESM audits (see lighthouse-config.test.js), so read their metadata in a child process.
 * @return {Promise<Array<{id: string, scoreDisplayMode?: string}>>}
 */
async function readMetas() {
  const script = `
    import config from '${CONFIG_PATH}';
    const out = [];
    for (const p of config.audits) {
      const mod = await import(new URL(p, 'file://${CONFIG_PATH}').href);
      out.push({
        id: mod.default.meta.id,
        scoreDisplayMode: mod.default.meta.scoreDisplayMode,
        supportedModes: mod.default.meta.supportedModes,
        requiredArtifacts: mod.default.meta.requiredArtifacts,
      });
    }
    console.log(JSON.stringify(out));
  `;
  const {stdout} = await execAsync(`node --input-type=module -e "${script.replace(/"/g, '\\"')}"`);
  return JSON.parse(stdout);
}

describe('recommended assertions', () => {
  /** @type {Map<string, any>} */
  const metas = new Map();

  beforeAll(async () => {
    for (const meta of await readMetas()) metas.set(meta.id, meta);
  }, 60000);

  it('asserts every scored audit exactly once', () => {
    const scored = [...metas.values()].filter(m => m.scoreDisplayMode !== 'informative');
    expect(scored.length).toBeGreaterThan(40);
    for (const meta of scored) expect(recommended[meta.id]).toBeDefined();
  });

  it('never asserts an informational audit (lhci cannot gate one) or an unknown id', () => {
    for (const id of Object.keys(recommended)) {
      expect(metas.has(id)).toBe(true);
      expect(metas.get(id).scoreDisplayMode).not.toBe('informative');
    }
  });

  it('uses only error or warn with a minScore', () => {
    for (const [id, value] of Object.entries(recommended)) {
      expect(['error', 'warn']).toContain(value[0]);
      expect([0.5, 1]).toContain(value[1].minScore);
      if (value[1].minScore === 0.5) expect(id).toBe('ssl-certificate-expiry');
    }
  });

  it('declares navigation-only mode on every audit that reads a navigation-only artifact', () => {
    const navigationOnly = ['DevtoolsLog', 'MainDocumentContent', 'FieldData'];
    for (const meta of metas.values()) {
      const needs = (meta.requiredArtifacts || []).some((/** @type {string} */ a) =>
        navigationOnly.includes(a)
      );
      if (needs) expect([meta.id, meta.supportedModes]).toEqual([meta.id, ['navigation']]);
    }
  });
});
