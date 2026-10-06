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
const {audit, lhr} = require('./fixtures.js');

const CLI = path.join(__dirname, '../../src/summary/cli.js');
const run = (/** @type {string[]} */ args) =>
  spawnSync('node', [CLI, ...args], {encoding: 'utf8', timeout: 30000});

/**
 * @param {Record<string, any>} audits
 * @param {{url?: string, fetchTime?: string}} [opts]
 * @return {string} A folder holding one result.
 */
function folderWith(audits, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-summary-'));
  fs.writeFileSync(path.join(dir, 'lhr-1.json'), JSON.stringify(lhr(audits, opts)));
  return dir;
}

describe('seo-summary command', () => {
  it('prints a markdown summary of a folder of results', () => {
    const dir = folderWith({
      'canonical-https': audit(0, {numericValue: 2}),
      'sitemap-valid': audit(1),
    });
    const r = run([dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^# SEO summary/);
    expect(r.stdout).toContain('`canonical-https`');
    expect(r.stdout).toMatch(/Overall: \d+\.\d/);
  }, 40000);

  it('prints JSON, and compares with an earlier folder', () => {
    const before = folderWith({'canonical-https': audit(0)});
    const after = folderWith({'canonical-https': audit(1), 'duplicate-titles': audit(0)});
    const r = run([after, '--compare', before, '--format', 'json']);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.comparisons[0].fixed.map((/** @type {any} */ x) => x.id)).toEqual([
      'canonical-https',
    ]);
    expect(data.comparisons[0].newIssues.map((/** @type {any} */ x) => x.id)).toEqual([
      'duplicate-titles',
    ]);
  }, 40000);

  it('keeps the latest result per page, skips files that are not Lighthouse results, and names them', () => {
    const dir = folderWith({'canonical-https': audit(0)}, {fetchTime: '2026-10-01T00:00:00Z'});
    fs.writeFileSync(
      path.join(dir, 'lhr-2.json'),
      JSON.stringify(lhr({'canonical-https': audit(1)}, {fetchTime: '2026-10-06T00:00:00Z'}))
    );
    fs.writeFileSync(path.join(dir, 'lhr-3.json'), '{"nope": true}');
    fs.writeFileSync(path.join(dir, 'lhr-4.json'), 'not json');
    const r = run([dir, '--format', 'json']);
    const data = JSON.parse(r.stdout);
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].issues).toEqual([]);
    expect(data.skipped.join(' ')).toMatch(/lhr-3\.json: not a Lighthouse result/);
    expect(data.skipped.join(' ')).toMatch(/lhr-4\.json/);
  }, 40000);

  it('writes to a file with --out', () => {
    const dir = folderWith({'canonical-https': audit(1)});
    const out = path.join(dir, 'summary.md');
    const r = run([dir, '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(fs.readFileSync(out, 'utf8')).toContain('# SEO summary');
  }, 40000);

  it('says so when there is no report, and exits 2 on bad usage', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-summary-'));
    expect(run([empty]).stdout).toMatch(/No report was found/);
    const bad = run([]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/Usage:/);
    expect(run([empty, '--top', '0']).status).toBe(2);
    expect(run([empty, '--format', 'xml']).status).toBe(2);
    expect(run([empty, '--wat']).status).toBe(2);
    expect(run(['--help']).status).toBe(0);
  }, 60000);
});
