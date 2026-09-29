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

const GATHERER_PATH = path.join(__dirname, '../../src/gatherers/pixel-width.js');

/**
 * Same shell-out pattern as the audit/registry tests: pixel-width.js transitively imports
 * rule-engine/registry.js, which uses `import.meta.url` at module scope and can't load inside
 * Jest under this repo's shared `module: "commonjs"` tsconfig.
 *
 * This mocks `driver.executionContext.evaluate` rather than actually running it — it exercises
 * only the gatherer's own control flow (does it resolve the ruleset, pass the right font strings
 * as args, request isolation, and return whatever evaluate resolves to unchanged). It does not
 * re-prove that canvas measurement works inside a real page's browser context — that mechanism
 * was verified live via a real `lhci collect` during design (see
 * docs/audit-specs/pixel-width-truncation.md) and is out of scope for a mocked unit test.
 * @param {unknown} evaluateResolution what the mocked evaluate() should resolve to
 * @return {Promise<{calls: any[], artifact: any}>}
 */
async function runGatherer(evaluateResolution) {
  const driverScript = `
    const {default: PixelWidth} = await import(${JSON.stringify(GATHERER_PATH)});
    const calls = [];
    const passContext = {
      driver: {
        executionContext: {
          evaluate: (fn, options) => {
            calls.push({args: options.args, useIsolation: options.useIsolation});
            return Promise.resolve(${JSON.stringify(evaluateResolution)});
          },
        },
      },
    };
    const gatherer = new PixelWidth();
    const artifact = await gatherer.getArtifact(passContext);
    console.log(JSON.stringify({calls, artifact}));
  `;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-audits-test-'));
  const driverPath = path.join(tmpDir, 'driver.mjs');
  fs.writeFileSync(driverPath, driverScript);

  try {
    const {stdout} = await execFileAsync('node', [driverPath]);
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
}

describe('PixelWidth gatherer', () => {
  it('resolves the real serp-pixel-budgets font strings and passes them as args, with isolation', async () => {
    const {calls} = await runGatherer({title: null, description: null, titleElementCount: 0});
    expect(calls).toHaveLength(1);
    expect(calls[0].useIsolation).toBe(true);
    expect(calls[0].args).toEqual(['400 20px Arial, sans-serif', '400 14px Arial, sans-serif']);
  }, 30000);

  it('returns the evaluated artifact unchanged when both fields are present', async () => {
    const resolution = {
      title: {text: 'A Page Title', widthPx: 250.5},
      description: {text: 'A meta description.', widthPx: 400.25},
      titleElementCount: 1,
    };
    const {artifact} = await runGatherer(resolution);
    expect(artifact).toEqual(resolution);
  }, 30000);

  it('returns the evaluated artifact unchanged when description is absent', async () => {
    const resolution = {
      title: {text: 'A Page Title', widthPx: 250.5},
      description: null,
      titleElementCount: 1,
    };
    const {artifact} = await runGatherer(resolution);
    expect(artifact).toEqual(resolution);
  }, 30000);

  it('returns the evaluated artifact unchanged when both fields are absent', async () => {
    const resolution = {title: null, description: null, titleElementCount: 0};
    const {artifact} = await runGatherer(resolution);
    expect(artifact).toEqual(resolution);
  }, 30000);

  it('passes through titleElementCount unchanged, including counts greater than one', async () => {
    const resolution = {title: null, description: null, titleElementCount: 3};
    const {artifact} = await runGatherer(resolution);
    expect(artifact.titleElementCount).toBe(3);
  }, 30000);
});
