/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  default: RobotsTxtSitemapDeclared,
} = require('../../src/audits/robots-txt-sitemap-declared.js');

/**
 * @param {{status: number | null, content: string | null}} RobotsTxt
 */
const run = RobotsTxt => RobotsTxtSitemapDeclared.audit({RobotsTxt});

describe('robots-txt-sitemap-declared audit', () => {
  it('passes with an absolute Sitemap URL', () => {
    expect(
      run({status: 200, content: 'User-agent: *\nSitemap: https://e.com/sitemap.xml'})
    ).toEqual({score: 1});
  });

  it('passes when at least one of several Sitemap values is valid', () => {
    expect(
      run({status: 200, content: 'Sitemap: /rel.xml\nSitemap: https://e.com/s.xml'}).score
    ).toBe(1);
  });

  it('fails when robots.txt has no Sitemap line', () => {
    const result = run({status: 200, content: 'User-agent: *\nDisallow:'});
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('no `Sitemap:` line');
  });

  it('fails when every Sitemap value is relative or non-http', () => {
    const result = run({status: 200, content: 'Sitemap: /sitemap.xml\nSitemap: ftp://e.com/s.xml'});
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('/sitemap.xml');
  });

  it('fails with a clear reason when robots.txt does not exist (404)', () => {
    const result = run({status: 404, content: ''});
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('No robots.txt');
  });

  it('is notApplicable when robots.txt is unavailable (5xx / fetch failure)', () => {
    expect(run({status: 503, content: null})).toEqual({score: null, notApplicable: true});
    expect(run({status: null, content: null})).toEqual({score: null, notApplicable: true});
  });
});
