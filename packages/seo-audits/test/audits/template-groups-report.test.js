/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {execFileSync} = require('child_process');
const path = require('path');
const {page, snapshot, artifact} = require('../lib/vertical-fixtures.js');

const AUDIT = path.join(__dirname, '../../src/audits/template-groups-report.js');

/** Runs the audit in real ESM, as Lighthouse does (the audit imports Lighthouse's own ESM base class). */
function run(siteCrawl) {
  const script = `
    const {default: Audit} = await import(${JSON.stringify(AUDIT)});
    const result = Audit.audit({SiteCrawl: ${JSON.stringify(siteCrawl)}});
    console.log(JSON.stringify({...result, mode: Audit.meta.scoreDisplayMode, id: Audit.meta.id}));
  `;
  return JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 60000})
  );
}

describe('template-groups-report audit', () => {
  it('is informational and reports a template shared by crawled pages', () => {
    const pages = ['a', 'b', 'c'].map(s =>
      page(`https://site.example/blog/${s}`, {title: `T ${s}`, h1: ['h'], wordCount: 500})
    );
    const result = run(artifact(snapshot(pages)));
    expect(result.id).toBe('template-groups-report');
    expect(result.mode).toBe('informative');
    expect(result.score).toBe(1);
    expect(result.details.items[0].pattern).toBe('/blog/:slug');
    expect(result.details.templates).toHaveLength(1);
  });

  it('is not applicable without a crawl or without a template', () => {
    expect(run({state: 'disabled', snapshot: null}).notApplicable).toBe(true);
    const result = run(artifact(snapshot([page('https://site.example/')])));
    expect(result.notApplicable).toBe(true);
  });
});
