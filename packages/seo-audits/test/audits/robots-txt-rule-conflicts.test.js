/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: RobotsTxtRuleConflicts} = require('../../src/audits/robots-txt-rule-conflicts.js');

/**
 * @param {string | null} content
 * @param {number | null} [status]
 */
const run = (content, status = 200) => RobotsTxtRuleConflicts.audit({RobotsTxt: {status, content}});

describe('robots-txt-rule-conflicts audit', () => {
  it('passes a file with no conflicts', () => {
    expect(run('User-agent: *\nDisallow: /private\nAllow: /private/public')).toEqual({score: 1});
  });

  it('fails when one group allows and disallows the identical path', () => {
    const result = run('User-agent: *\nDisallow: /shop\nAllow: /shop');
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([{agent: '*', path: '/shop', lines: '3 / 2'}]);
  });

  it('catches a contradiction split across two groups naming the same user-agent', () => {
    const result = run(
      'User-agent: Googlebot\nDisallow: /a\n\nUser-agent: *\nDisallow: /z\n\nUser-agent: Googlebot\nAllow: /a'
    );
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([{agent: 'googlebot', path: '/a', lines: '8 / 2'}]);
  });

  it('reports each agent in a shared group separately', () => {
    const result = run('User-agent: a\nUser-agent: b\nAllow: /x\nDisallow: /x');
    expect(result.details.items.map(i => i.agent)).toEqual(['a', 'b']);
  });

  it('does not flag the same path across different user-agents', () => {
    expect(run('User-agent: a\nDisallow: /x\n\nUser-agent: b\nAllow: /x').score).toBe(1);
  });

  it('does not flag different paths, or an empty Disallow next to an Allow', () => {
    expect(run('User-agent: *\nDisallow: /x\nAllow: /x/y\nDisallow:\nAllow: /').score).toBe(1);
  });

  it('does not flag repeating the same rule type', () => {
    expect(run('User-agent: *\nDisallow: /x\nDisallow: /x').score).toBe(1);
  });

  it('passes when robots.txt is absent and is notApplicable when unavailable', () => {
    expect(run('', 404)).toEqual({score: 1});
    expect(run(null, 503)).toEqual({score: null, notApplicable: true});
  });
});
