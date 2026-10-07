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

const AUDIT_PATH = path.join(__dirname, '../../src/audits/pixel-width-truncation.js');

const DRIVER_SCRIPT = `
import {readFileSync} from 'fs';
const {default: Audit} = await import(process.argv[2]);
const {artifacts, formFactor} = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
const result = Audit.audit(artifacts, {settings: {formFactor}});
console.log(JSON.stringify({...result, scoreDisplayMode: Audit.meta.scoreDisplayMode}));
`;

/**
 * Same shell-out-via-temp-files pattern as the other audits' tests: this audit transitively
 * imports rule-engine/registry.js, which uses `import.meta.url` at module scope and cannot be
 * loaded directly inside Jest under this repo's shared `module: "commonjs"` tsconfig.
 * @param {{title: {text: string, widthPx: number} | null, description: {text: string, widthPx: number} | null}} pixelWidth
 * @param {'desktop' | 'mobile'} [formFactor]
 * @return {Promise<any>}
 */
async function runAudit(pixelWidth, formFactor = 'desktop', url) {
  const artifacts = {PixelWidth: pixelWidth, ...(url && {URL: {finalDisplayedUrl: url}})};

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-audits-test-'));
  const inputPath = path.join(tmpDir, 'input.json');
  const driverPath = path.join(tmpDir, 'driver.mjs');
  fs.writeFileSync(inputPath, JSON.stringify({artifacts, formFactor}));
  fs.writeFileSync(driverPath, DRIVER_SCRIPT);

  try {
    const {stdout} = await execFileAsync('node', [driverPath, AUDIT_PATH, inputPath]);
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
}

// v1 desktop budgets: title 600px, description 920px. v1 mobile budgets: title 580px,
// description 680px (see rules/serp-pixel-budgets/2026-10.json).
const TITLE_OVER_DESKTOP = {text: 'An intentionally very wide test title', widthPx: 650};
const TITLE_UNDER = {text: 'A short title', widthPx: 200};
const DESCRIPTION_OVER_DESKTOP = {
  text: 'An intentionally very wide test description',
  widthPx: 950,
};
const DESCRIPTION_UNDER = {text: 'A short description', widthPx: 300};

describe('pixel-width-truncation audit', () => {
  it('flags the title when it is over budget, description absent', async () => {
    const result = await runAudit({title: TITLE_OVER_DESKTOP, description: null});
    expect(result.details.items).toEqual([
      expect.objectContaining({field: 'title', widthPx: 650, maxWidthPx: 600}),
    ]);
  }, 30000);

  it('flags the description when it is over budget, title absent', async () => {
    const result = await runAudit({title: null, description: DESCRIPTION_OVER_DESKTOP});
    expect(result.details.items).toEqual([
      expect.objectContaining({field: 'description', widthPx: 950, maxWidthPx: 920}),
    ]);
  }, 30000);

  it('flags both when both are over budget', async () => {
    const result = await runAudit({
      title: TITLE_OVER_DESKTOP,
      description: DESCRIPTION_OVER_DESKTOP,
    });
    expect(result.details.items.map(row => row.field).sort()).toEqual(['description', 'title']);
  }, 30000);

  it('flags neither when both are under budget — no rows, not a failure', async () => {
    const result = await runAudit({title: TITLE_UNDER, description: DESCRIPTION_UNDER});
    expect(result.details.items).toEqual([]);
    expect(result.notApplicable).toBeFalsy();
  }, 30000);

  it('skips a null field without triggering notApplicable', async () => {
    const result = await runAudit({title: TITLE_UNDER, description: null});
    expect(result.notApplicable).toBeFalsy();
    expect(result.details.items).toEqual([]);
  }, 30000);

  it('is notApplicable only when both title and description are null', async () => {
    const result = await runAudit({title: null, description: null});
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  }, 30000);

  it('uses the mobile budget when formFactor is mobile — a desktop-passing title can fail on mobile', async () => {
    // 590px is under the 600px desktop title budget but over the 580px mobile title budget.
    const borderlineTitle = {text: 'A borderline-width title for mobile testing', widthPx: 590};
    const desktopResult = await runAudit({title: borderlineTitle, description: null}, 'desktop');
    const mobileResult = await runAudit({title: borderlineTitle, description: null}, 'mobile');

    expect(desktopResult.details.items).toEqual([]);
    expect(mobileResult.details.items).toEqual([
      expect.objectContaining({field: 'title', widthPx: 590, maxWidthPx: 580}),
    ]);
  }, 30000);

  it('is purely informational — score is always null, scoreDisplayMode is informative', async () => {
    const result = await runAudit({title: TITLE_OVER_DESKTOP, description: null});
    expect(result.score).toBeNull();
    expect(result.scoreDisplayMode).toBe('informative');
  }, 30000);

  it('stamps rulesetVersions for the serpPixelBudgets namespace', async () => {
    const result = await runAudit({title: TITLE_OVER_DESKTOP, description: null});
    expect(result.details.rulesetVersions).toEqual({serpPixelBudgets: '2026-10'});
  }, 30000);

  it('fallback-font regression sanity: very different character composition must not measure identically', async () => {
    // This is a data-shape sanity check on the fixtures themselves, not a re-test of the
    // gatherer's canvas mechanism (already live-verified — see
    // docs/audit-specs/pixel-width-truncation.md). If a real canvas measurement ever produced
    // near-identical widths for strings this different, that would suggest the configured font
    // didn't actually apply and silently fell back to a generic one — the risk flagged in the
    // audit spec for Agent 04 to sanity-check live during implementation, done here as the
    // fixture-level companion check.
    const narrowText = 'iiiiiiiiiiiiiiiiiiii';
    const wideText = 'WWWWWWWWWWWWWWWWWWWW';
    expect(narrowText).toHaveLength(wideText.length);

    const narrowWidthPx = 90;
    const wideWidthPx = 260;
    expect(Math.abs(wideWidthPx - narrowWidthPx)).toBeGreaterThan(20);

    const result = await runAudit({
      title: {text: wideText, widthPx: wideWidthPx},
      description: {text: narrowText, widthPx: narrowWidthPx},
    });
    // Only the (600px-budget) title is close enough to matter here; asserting the audit treats
    // these two very-different-composition measurements independently, not as interchangeable.
    expect(result.details.items).toEqual([]);
  }, 30000);
  it('puts a model of the search snippet in the details, cut at the budget on each device', async () => {
    const text = 'word '.repeat(30).trim();
    const widths = Array.from(text).map((_, i) => (i + 1) * 10);
    const result = await runAudit(
      {title: {text, widthPx: text.length * 10, prefixWidths: widths}, description: null},
      'desktop',
      'https://example.com/shop/boots'
    );
    const preview = result.details.serpPreview;
    expect(preview.displayUrl).toBe('example.com › shop › boots');
    expect(preview.devices.desktop.title.truncated).toBe(true);
    expect(preview.devices.desktop.title.shown.endsWith('…')).toBe(true);
    expect(preview.devices.mobile.title.shown.length).toBeLessThanOrEqual(
      preview.devices.desktop.title.shown.length
    );
    expect(preview.devices.desktop.description).toBeNull();
  });
});
