/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildBrokenExternalLinksProduct,
  verdictOf,
  MAX_ROWS,
} = require('../../src/lib/crawl-external-links.js');

const ext = (/** @type {string} */ url, anchor = 'a link') => ({url, anchor, nofollow: false});
/** @param {any[]} externalLinks @param {any} [over] */
const audited = (externalLinks, over = {}) => ({
  url: 'https://example.com/',
  finalUrl: 'https://example.com/',
  extraction: 'ok',
  source: 'audited',
  externalLinks,
  links: [],
  ...over,
});
const check = (
  /** @type {string} */ url,
  /** @type {number | null} */ status,
  error = null,
  hops = []
) => ({
  url,
  finalUrl: hops.length ? hops[hops.length - 1].location : url,
  status,
  hops,
  error,
  state: 'checked',
});
/** @param {any[]} links @param {any[]} checked @param {number} [notChecked] @param {any} [extra] */
const artifact = (links, checked, notChecked = 0, extra = {}) => ({
  state: 'crawled',
  auditedUrl: 'https://example.com/',
  reason: null,
  auditedRenderedTextLength: null,
  linkChecks: null,
  externalChecks: {checked, notChecked},
  snapshot: {origin: 'https://example.com', pages: [audited(links)], skipped: []},
  ...extra,
});
const run = (/** @type {any} */ a) => buildBrokenExternalLinksProduct(a);

describe('verdictOf', () => {
  it.each([
    [404, null, 'broken'],
    [410, null, 'broken'],
    [null, 'ENOTFOUND', 'broken'],
    [null, 'ECONNREFUSED', 'broken'],
    [200, null, 'ok'],
    [204, null, 'ok'],
    [500, null, 'unreliable'],
    [503, null, 'unreliable'],
    [302, null, 'unreliable'],
    [null, null, 'unreliable'],
    [null, 'TIMEOUT', 'unreliable'],
    [null, 'ECONNRESET', 'unreliable'],
    [null, 'EAI_AGAIN', 'unreliable'],
    [null, 'TLS', 'unreliable'],
    [null, 'TOO_MANY_REDIRECTS', 'unreliable'],
    [null, 'OTHER', 'unreliable'],
    [401, null, 'ignored'],
    [403, null, 'ignored'],
    [429, null, 'ignored'],
    [999, null, 'ignored'],
    [400, null, 'ignored'],
    [451, null, 'ignored'],
    [null, 'PRIVATE', 'ignored'],
  ])('status %s, error %s is %s', (status, error, expected) => {
    // @ts-expect-error - partial test check
    expect(verdictOf(check('https://x.test/', status, error))).toBe(expected);
  });
});

describe('broken-external-links', () => {
  it.each([null, undefined, {}, 5, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(run(input).notApplicable).toBe(true);
    }
  );

  it('is not applicable when the audited page was not read, has no external links, or the checks did not run', () => {
    const unread = artifact([], []);
    unread.snapshot.pages = [audited([ext('https://a.test/')], {extraction: 'error'})];
    expect(run(unread).notApplicable).toBe(true);
    expect(run(artifact([], [])).explanation).toMatch(/no links to other sites/);
    const off = artifact([ext('https://a.test/')], [], 0, {externalChecks: null});
    expect(run(off).notApplicable).toBe(true);
    expect(run(off).explanation).toMatch(/LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS=0/);
  });

  it('passes when every link answers, saying how many were checked', () => {
    const product = run(
      artifact(
        [ext('https://a.test/'), ext('https://b.test/')],
        [check('https://a.test/', 200), check('https://b.test/', 200)]
      )
    );
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('No broken external links (2 of 2 external links checked)');
  });

  it('fails a link that is gone, with the anchor text and the result', () => {
    const product = run(
      artifact([ext('https://a.test/gone', 'Our partner')], [check('https://a.test/gone', 404)])
    );
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('1 broken external link (1 of 1 external links checked)');
    expect(product.details.items[0]).toMatchObject({
      link: 'https://a.test/gone',
      anchor: 'Our partner',
      result: 'HTTP 404',
      note: 'gone',
    });
  });

  it('fails a host that does not exist or refuses connections, and names it in plain words', () => {
    const product = run(
      artifact(
        [ext('https://dead.test/'), ext('https://closed.test/')],
        [
          check('https://dead.test/', null, 'ENOTFOUND'),
          check('https://closed.test/', null, 'ECONNREFUSED'),
        ]
      )
    );
    expect(product.score).toBe(0);
    expect(product.details.items.map((/** @type {any} */ i) => i.result)).toEqual([
      'host not found',
      'connection refused',
    ]);
  });

  it('lists server errors and timeouts without failing on them', () => {
    const product = run(
      artifact(
        [ext('https://a.test/'), ext('https://b.test/')],
        [check('https://a.test/', 503), check('https://b.test/', null, 'TIMEOUT')]
      )
    );
    expect(product.score).toBe(1);
    expect(product.details.items.map((/** @type {any} */ i) => i.result)).toEqual([
      'HTTP 503',
      'timed out',
    ]);
    expect(product.explanation).toMatch(/2 links did not answer reliably \(listed, not judged\)/);
  });

  it('does not judge 401, 403, 429 or a refused private address, and counts them', () => {
    const product = run(
      artifact(
        [
          ext('https://a.test/'),
          ext('https://b.test/'),
          ext('https://c.test/'),
          ext('http://127.0.0.1/x'),
        ],
        [
          check('https://a.test/', 403),
          check('https://b.test/', 429),
          check('https://c.test/', 999),
          check('http://127.0.0.1/x', null, 'PRIVATE'),
        ]
      )
    );
    expect(product.score).toBe(1);
    expect(product.explanation).toMatch(
      /3 links answered 401, 403, 429 or similar and were not judged; 1 link points at a private address and was not requested/
    );
  });

  it('shows a link that redirected before it died, and reports unchecked links honestly', () => {
    const hops = [{url: 'https://a.test/old', status: 301, location: 'https://a.test/new'}];
    const product = run(
      artifact([ext('https://a.test/old')], [check('https://a.test/old', 404, null, hops)], 3)
    );
    expect(product.details.items[0].note).toMatch(
      /after 1 redirect to https:\/\/a\.test\/new; gone/
    );
    expect(product.displayValue).toMatch(/1 of 1 external links checked, 3 not checked/);
  });

  it('says "at least" when the page has as many external links as the extractor keeps', () => {
    const links = Array.from({length: 20}, (_, i) => ext(`https://h${i}.test/`));
    const product = run(
      artifact(
        links,
        links.slice(0, 5).map(l => check(l.url, 200)),
        15
      )
    );
    expect(product.displayValue).toMatch(/5 of at least 20 external links checked, 15 not checked/);
  });

  it('caps the rows', () => {
    const links = Array.from({length: 80}, (_, i) => ext(`https://h${i}.test/`));
    const product = run(
      artifact(
        links,
        links.map(l => check(l.url, 404))
      )
    );
    expect(product.details.items).toHaveLength(MAX_ROWS + 1);
    expect(product.details.items[MAX_ROWS].link).toBe('30 more not shown');
  });

  it('clips a very long URL and anchor, and survives odd stored data', () => {
    const long = `https://a.test/${'x'.repeat(5000)}`;
    const product = run(artifact([ext(long, 'y'.repeat(5000))], [check(long, 404)]));
    expect(product.details.items[0].link.length).toBeLessThan(210);
    expect(product.details.items[0].anchor.length).toBeLessThan(210);
    expect(() =>
      run(artifact([ext('https://a.test/')], [null, 5, 'x', check('https://a.test/', 200)]))
    ).not.toThrow();
    expect(
      run(artifact([ext('https://a.test/')], [null, check('https://a.test/', 200)])).displayValue
    ).toMatch(/1 of 1 external links checked/);
  });
});
