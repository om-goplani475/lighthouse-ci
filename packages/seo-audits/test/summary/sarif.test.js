/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {summarizeRun} = require('../../src/summary/run-summary.js');
const {toSarif, isRepoPath, MAX_RESULTS} = require('../../src/summary/sarif.js');
const {RECOMMENDED, audit, lhr} = require('./fixtures.js');

const summarize = (/** @type {Record<string, any>} */ audits, /** @type {any} */ opts) =>
  summarizeRun(lhr(audits, opts), RECOMMENDED);

describe('toSarif', () => {
  const run = summarize({
    'canonical-https': audit(0, {numericValue: 2, title: 'Canonical uses https'}),
    'document-title-quality': audit(0.5),
    'sitemap-valid': audit(1),
    'duplicate-titles': audit(null),
  });

  it('writes a SARIF 2.1.0 log with one rule per failing audit and one result per issue', () => {
    const log = toSarif([run], {toolVersion: '1.2.3'});
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toContain('sarif-schema-2.1.0.json');
    const sarifRun = log.runs[0];
    expect(sarifRun.tool.driver).toMatchObject({name: 'lhci-seo-audits', version: '1.2.3'});
    expect(sarifRun.tool.driver.rules.map(r => r.id)).toEqual([
      'canonical-https',
      'document-title-quality',
    ]);
    expect(sarifRun.results.map(r => r.ruleId)).toEqual([
      'canonical-https',
      'document-title-quality',
    ]);
    // passing and not-applicable audits are never results
    expect(JSON.stringify(log)).not.toContain('sitemap-valid');
    expect(JSON.stringify(log)).not.toContain('duplicate-titles');
  });

  it('maps a failing error-tier audit to error and everything else to warning', () => {
    const results = toSarif([run]).runs[0].results;
    expect(results.find(r => r.ruleId === 'canonical-https').level).toBe('error');
    expect(results.find(r => r.ruleId === 'document-title-quality').level).toBe('warning');
    const rules = toSarif([run]).runs[0].tool.driver.rules;
    expect(rules.find(r => r.id === 'canonical-https').defaultConfiguration.level).toBe('error');
    expect(rules.find(r => r.id === 'document-title-quality').defaultConfiguration.level).toBe(
      'warning'
    );
  });

  it('points at the page URL by default, and keeps rule indexes consistent', () => {
    const log = toSarif([run]);
    const rules = log.runs[0].tool.driver.rules;
    for (const r of log.runs[0].results) {
      expect(rules[r.ruleIndex].id).toBe(r.ruleId);
      expect(r.locations[0].physicalLocation.artifactLocation.uri).toBe('https://example.com/');
      expect(r.locations[0].logicalLocations[0]).toEqual({
        name: 'https://example.com/',
        kind: 'resource',
      });
    }
  });

  it('can attach every result to a repository file, keeping the page in the message', () => {
    const log = toSarif([run], {fileUri: 'lighthouserc.js'});
    const r = log.runs[0].results[0];
    expect(r.locations[0].physicalLocation).toEqual({
      artifactLocation: {uri: 'lighthouserc.js'},
      region: {startLine: 1},
    });
    expect(r.message.text).toContain('https://example.com/');
    expect(r.properties.url).toBe('https://example.com/');
  });

  it('refuses a file path that leaves the repository', () => {
    for (const bad of [
      '../x',
      '/etc/passwd',
      'a/../b',
      'file:///x',
      'a\\b',
      '',
      'a//b',
      'a/./b',
      'x?y',
    ]) {
      expect(() => toSarif([run], {fileUri: bad})).toThrow(/relative path/);
    }
  });

  it('gives a stable fingerprint per rule and page, different across pages', () => {
    const a = toSarif([run]).runs[0].results[0].partialFingerprints['lhciSeoAudit/v1'];
    expect(toSarif([run]).runs[0].results[0].partialFingerprints['lhciSeoAudit/v1']).toBe(a);
    const other = summarize({'canonical-https': audit(0)}, {url: 'https://example.com/other'});
    const both = toSarif([run, other]).runs[0].results.filter(r => r.ruleId === 'canonical-https');
    expect(both).toHaveLength(2);
    expect(new Set(both.map(r => r.partialFingerprints['lhciSeoAudit/v1'])).size).toBe(2);
    expect(
      toSarif([run, other]).runs[0].tool.driver.rules.filter(r => r.id === 'canonical-https')
    ).toHaveLength(1);
  });

  it('writes a valid empty log for a clean page', () => {
    const clean = summarize({'canonical-https': audit(1)});
    const log = toSarif([clean]);
    expect(log.runs[0].results).toEqual([]);
    expect(log.runs[0].tool.driver.rules).toEqual([]);
    expect(log.runs[0].properties).toEqual({pages: ['https://example.com/'], truncated: false});
  });

  it('keeps hostile text as plain data and bounds its size', () => {
    const hostile = summarize({
      'canonical-https': audit(0, {
        title: '<script>alert(1)</script>',
        displayValue: 'x'.repeat(5000),
        description: 'd'.repeat(5000),
      }),
    });
    const log = toSarif([hostile]);
    const r = log.runs[0].results[0];
    expect(r.message.text.length).toBeLessThanOrEqual(1000);
    expect(log.runs[0].tool.driver.rules[0].fullDescription.text.length).toBeLessThanOrEqual(1000);
    expect(JSON.parse(JSON.stringify(log))).toEqual(log);
  });

  it(`writes at most ${MAX_RESULTS} results and says so`, () => {
    const pages = Array.from({length: MAX_RESULTS + 5}, (_, i) =>
      summarize({'canonical-https': audit(0)}, {url: `https://example.com/p${i}`})
    );
    const sarifRun = toSarif(pages).runs[0];
    expect(sarifRun.results).toHaveLength(MAX_RESULTS);
    expect(sarifRun.properties.truncated).toBe(true);
  });
});

describe('isRepoPath', () => {
  it('accepts plain relative paths only', () => {
    expect(isRepoPath('lighthouserc.js')).toBe(true);
    expect(isRepoPath('src/pages/index.html')).toBe(true);
    expect(isRepoPath('..')).toBe(false);
    expect(isRepoPath('a/b/')).toBe(false);
    expect(isRepoPath('a\u0000b')).toBe(false);
    expect(isRepoPath(undefined)).toBe(false);
    expect(isRepoPath('x'.repeat(301))).toBe(false);
  });
});

describe('seo-summary --format sarif', () => {
  const CLI = path.join(__dirname, '../../src/summary/cli.js');
  const folder = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-sarif-'));
    fs.writeFileSync(
      path.join(dir, 'lhr-1.json'),
      JSON.stringify(lhr({'canonical-https': audit(0)}))
    );
    return dir;
  };

  it('prints SARIF, with the package version', () => {
    const r = spawnSync('node', [CLI, folder(), '--format', 'sarif'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    const log = JSON.parse(r.stdout);
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0].tool.driver.version).toMatch(/^\d+\.\d+\.\d+/);
  }, 40000);

  it('takes --sarif-file, and refuses an unsafe one with a usage error', () => {
    const ok = spawnSync(
      'node',
      [CLI, folder(), '--format', 'sarif', '--sarif-file', 'lighthouserc.js'],
      {encoding: 'utf8', timeout: 30000}
    );
    expect(
      JSON.parse(ok.stdout).runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri
    ).toBe('lighthouserc.js');
    const bad = spawnSync('node', [CLI, folder(), '--format', 'sarif', '--sarif-file', '../x'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('--sarif-file');
  }, 40000);
});
