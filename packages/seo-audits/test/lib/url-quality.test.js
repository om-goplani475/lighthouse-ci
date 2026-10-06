/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildUrlRuleProduct,
  RULES,
  MAX_URL_LENGTH,
  EXTREME_URL_LENGTH,
  MAX_PARAMS,
  MAX_ROWS,
  isTrackingParam,
  isSessionParam,
} = require('../../src/lib/url-quality.js');

/**
 * @param {string} auditedUrl
 * @param {any[]} [pages]
 * @param {any} [extra]
 */
const artifact = (auditedUrl, pages = [], extra = {}) => ({
  state: 'crawled',
  auditedUrl,
  reason: null,
  snapshot: {pages},
  ...extra,
});
const page = (url, over = {}) => ({url, finalUrl: url, extraction: 'ok', status: 200, ...over});
// @ts-expect-error - partial test artifacts
const run = (a, rule) => buildUrlRuleProduct(a, RULES[rule]);

describe('url-length', () => {
  it('passes a short URL', () => {
    const p = run(artifact('https://example.com/about'), 'length');
    expect(p.score).toBe(1);
    expect(p.displayValue).toMatch(/No problem found/);
  });

  it('notes a URL past 115 characters (path plus query, not the host) and fails only an extreme one', () => {
    const long = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;
    const p = run(artifact(long), 'length');
    expect(p.score).toBe(1);
    expect(p.details.items[0].problem).toMatch(/116 characters .*a note above 115/);
    expect(p.details.items[0].page).toBe('audited page (note)');
    expect(
      run(artifact(`https://example.com/${'a'.repeat(MAX_URL_LENGTH - 1)}`), 'length').displayValue
    ).toMatch(/No problem found/);
    const extreme = run(
      artifact(`https://example.com/${'a'.repeat(EXTREME_URL_LENGTH)}`),
      'length'
    );
    expect(extreme.score).toBe(0);
    expect(extreme.details.items[0].problem).toMatch(/extreme/);
  });

  it('lists other long crawled URLs without failing', () => {
    const long = `https://example.com/${'a'.repeat(200)}`;
    const p = run(artifact('https://example.com/', [page(long)]), 'length');
    expect(p.score).toBe(1);
    expect(p.details.items[0]).toMatchObject({page: 'other crawled page (note)'});
    expect(p.displayValue).toMatch(/1 on other crawled URLs/);
  });
});

describe('url-query-parameters', () => {
  it('fails on more than the limit', () => {
    const q = Array.from({length: MAX_PARAMS + 1}, (_, i) => `p${i}=1`).join('&');
    const p = run(artifact(`https://example.com/?${q}`), 'params');
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toMatch(/4 query parameters/);
  });
  it('passes at the limit', () => {
    expect(run(artifact('https://example.com/?a=1&b=2&c=3'), 'params').score).toBe(1);
  });
});

describe('url-session-tracking', () => {
  it('fails on a session id in the query', () => {
    const p = run(artifact('https://example.com/?PHPSESSID=abc'), 'session');
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toMatch(/session ID in the query/);
  });
  it('fails on a jsessionid path parameter', () => {
    expect(run(artifact('https://example.com/a;jsessionid=ABC123'), 'session').score).toBe(0);
  });
  it('counts sid only when the value looks like an identifier', () => {
    expect(run(artifact('https://example.com/?sid=3'), 'session').score).toBe(1);
    expect(run(artifact('https://example.com/?sid=0123456789abcdef0123'), 'session').score).toBe(0);
  });
  it('notes tracking parameters and passes', () => {
    const p = run(artifact('https://example.com/?utm_source=x&gclid=1&q=a'), 'session');
    expect(p.score).toBe(1);
    expect(p.details.items).toHaveLength(2);
    expect(p.details.items[0].page).toBe('audited page (note)');
    expect(p.displayValue).toMatch(/carries no session ID/);
  });
  it('fails when a session id and a tracking note are both present', () => {
    const p = run(artifact('https://example.com/?utm_medium=a&jsessionid=z'), 'session');
    expect(p.score).toBe(0);
    expect(p.details.items).toHaveLength(2);
  });
  it('classifies names case-insensitively', () => {
    expect(isTrackingParam('UTM_Campaign')).toBe(true);
    expect(isTrackingParam('page')).toBe(false);
    expect(isSessionParam('ASPSESSIONIDQQCCSAAB', 'x')).toBe(true);
  });
});

describe('url-encoding', () => {
  it('fails on repeated slashes', () => {
    const p = run(artifact('https://example.com/a//b'), 'encoding');
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toMatch(/repeated slashes/);
  });
  it('fails on a stray percent and on double encoding', () => {
    expect(run(artifact('https://example.com/100%/x'), 'encoding').score).toBe(0);
    const p = run(artifact('https://example.com/a%2520b'), 'encoding');
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toMatch(/double encoding/);
  });
  it('passes valid encoding', () => {
    expect(run(artifact('https://example.com/caf%C3%A9?q=a%20b'), 'encoding').score).toBe(1);
  });
});

describe('applicability and robustness', () => {
  it('works with the crawl switched off (the audited URL is still known)', () => {
    const p = run(
      artifact('https://example.com/a//b', [], {state: 'disabled', snapshot: null}),
      'encoding'
    );
    expect(p.score).toBe(0);
  });
  it('is not applicable without an artifact or a readable URL', () => {
    // @ts-expect-error - deliberately wrong input
    expect(buildUrlRuleProduct(null, RULES.length).notApplicable).toBe(true);
    expect(run(artifact('not a url'), 'length').notApplicable).toBe(true);
    expect(run(artifact('ftp://example.com/'), 'length').notApplicable).toBe(true);
  });
  it('skips malformed pages and counts each URL once', () => {
    const long = `https://example.com/${'a'.repeat(200)}`;
    const p = run(
      artifact('https://example.com/', [
        null,
        {url: 5},
        page(long),
        page(long),
        page('https://example.com/'),
      ]),
      'length'
    );
    expect(p.details.items).toHaveLength(1);
  });
  it('caps the rows and says how many are hidden', () => {
    const pages = Array.from({length: MAX_ROWS + 5}, (_, i) =>
      page(`https://example.com/${'a'.repeat(200)}${i}`)
    );
    const p = run(artifact('https://example.com/', pages), 'length');
    expect(p.details.items).toHaveLength(MAX_ROWS + 1);
    expect(p.details.items[MAX_ROWS].url).toBe('5 more not shown');
  });
});
