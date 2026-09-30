/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {parseRobotsTxt, robotsTxtState} = require('../../src/lib/robots-txt.js');

describe('parseRobotsTxt', () => {
  it('groups consecutive User-agent lines and records rules with line numbers', () => {
    const {groups} = parseRobotsTxt(
      'User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /a\nAllow: /a/b\n\nUser-agent: *\nDisallow:'
    );
    expect(groups).toEqual([
      {
        agents: ['googlebot', 'bingbot'],
        rules: [
          {type: 'disallow', path: '/a', line: 3},
          {type: 'allow', path: '/a/b', line: 4},
        ],
      },
      {agents: ['*'], rules: [{type: 'disallow', path: '', line: 7}]},
    ]);
  });

  it('is case-insensitive on directives, strips comments, and handles CRLF', () => {
    const {groups, sitemaps} = parseRobotsTxt(
      'USER-AGENT: *  # everyone\r\nDISALLOW: /x # nope\r\nSITEMAP: https://e.com/s.xml'
    );
    expect(groups[0].rules).toEqual([{type: 'disallow', path: '/x', line: 2}]);
    expect(sitemaps).toEqual(['https://e.com/s.xml']);
  });

  it('collects Sitemap lines regardless of position and ignores rules outside any group', () => {
    const {groups, sitemaps} = parseRobotsTxt(
      'Disallow: /orphan\nSitemap: https://e.com/a.xml\nUser-agent: *\nDisallow: /b\nSitemap: https://e.com/b.xml'
    );
    expect(sitemaps).toEqual(['https://e.com/a.xml', 'https://e.com/b.xml']);
    expect(groups).toHaveLength(1);
    expect(groups[0].rules).toHaveLength(1);
  });
});

describe('robotsTxtState', () => {
  it.each([
    [{status: 200, content: 'x'}, 'present'],
    [{status: 404, content: ''}, 'absent'],
    [{status: 403, content: null}, 'absent'],
    [{status: 503, content: null}, 'unavailable'],
    [{status: null, content: null, errorMessage: 'net::ERR'}, 'unavailable'],
  ])('%j -> %s', (artifact, expected) => {
    expect(robotsTxtState(artifact)).toBe(expected);
  });
});
