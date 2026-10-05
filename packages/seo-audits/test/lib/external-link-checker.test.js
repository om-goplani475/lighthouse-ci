/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  checkExternalLinks,
  errorCodeOf,
  PER_HOST,
  CONCURRENCY,
  MAX_HOPS,
  BUDGET_MS,
  MAX_BODY_BYTES,
} = require('../../src/lib/external-link-checker.js');
const {USER_AGENT} = require('../../src/lib/crawl-snapshot.js');

const response = (/** @type {number} */ status, location = null) => ({
  status,
  redirectLocation: location,
  headers: {},
  body: Buffer.alloc(0),
  bodyRead: 'skipped-status',
  truncated: false,
});
/**
 * A scripted web: url -> a status, {status, location}, or an Error. Anything else answers 200.
 * @param {Record<string, any>} routes
 */
function makeWeb(routes = {}) {
  /** @type {Array<{url: string, options: any}>} */
  const requests = [];
  const inFlightByHost = new Map();
  let inFlight = 0;
  const stats = {maxInFlight: 0, maxPerHost: 0};
  let clock = 0;
  const web = {
    requests,
    stats,
    msPerRequest: 0,
    now: () => clock,
    fetchPage: async (/** @type {string} */ url, /** @type {any} */ options) => {
      requests.push({url, options});
      const host = new URL(url).host;
      inFlight++;
      inFlightByHost.set(host, (inFlightByHost.get(host) || 0) + 1);
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      stats.maxPerHost = Math.max(stats.maxPerHost, inFlightByHost.get(host));
      await new Promise(resolve => setImmediate(resolve));
      clock += web.msPerRequest;
      inFlight--;
      inFlightByHost.set(host, inFlightByHost.get(host) - 1);
      const route = routes[url];
      if (route instanceof Error) throw route;
      if (typeof route === 'number') return response(route);
      if (route && typeof route === 'object') return response(route.status, route.location);
      return response(200);
    },
  };
  return web;
}
const run = (/** @type {any} */ web, /** @type {string[]} */ urls, limit = 20) =>
  checkExternalLinks({
    links: urls.map(url => ({url})),
    limit,
    fetchPage: web.fetchPage,
    now: web.now,
  });
const err = (/** @type {string} */ code, message = code) =>
  Object.assign(new Error(message), {code});

describe('checkExternalLinks', () => {
  it('checks each distinct http(s) link once and reads the status', async () => {
    const web = makeWeb({'https://a.test/gone': 404, 'https://b.test/ok': 200});
    const result = await run(web, [
      'https://a.test/gone',
      'https://b.test/ok',
      'https://b.test/ok',
      'mailto:a@b.c',
      'ftp://c.test/x',
      'not a url',
    ]);
    expect(result.notChecked).toBe(0);
    expect(result.checked.map(c => [c.url, c.status, c.error]).sort()).toEqual([
      ['https://a.test/gone', 404, null],
      ['https://b.test/ok', 200, null],
    ]);
    expect(web.requests).toHaveLength(2);
  });

  it('sends the crawler user-agent, a tiny body cap and a per-request timeout, and nothing else', async () => {
    const web = makeWeb();
    await run(web, ['https://a.test/']);
    expect(web.requests[0].options).toEqual({
      timeoutMs: 5000,
      maxBytes: MAX_BODY_BYTES,
      userAgent: USER_AGENT,
    });
    expect(MAX_BODY_BYTES).toBe(1024);
  });

  it('checks at most two links per host and counts the rest as not checked', async () => {
    const web = makeWeb();
    const urls = Array.from({length: 6}, (_, i) => `https://one.test/p${i}`);
    const result = await run(web, [...urls, 'https://two.test/x']);
    expect(PER_HOST).toBe(2);
    expect(result.checked).toHaveLength(3);
    expect(result.notChecked).toBe(4);
    expect(web.requests.filter(r => r.url.startsWith('https://one.test/'))).toHaveLength(2);
  });

  it('never has two requests in flight to one host, and never more than five overall', async () => {
    const web = makeWeb();
    const urls = [];
    for (let h = 0; h < 12; h++) for (let k = 0; k < 2; k++) urls.push(`https://h${h}.test/p${k}`);
    await run(web, urls);
    expect(web.stats.maxPerHost).toBe(1);
    expect(web.stats.maxInFlight).toBeLessThanOrEqual(CONCURRENCY);
    expect(web.stats.maxInFlight).toBeGreaterThan(1);
  });

  it('honours the limit, and a limit of zero checks nothing', async () => {
    const web = makeWeb();
    const urls = Array.from({length: 10}, (_, i) => `https://h${i}.test/`);
    expect((await run(web, urls, 4)).checked).toHaveLength(4);
    expect((await run(web, urls, 4)).notChecked).toBe(6);
    const none = await run(makeWeb(), urls, 0);
    expect(none.checked).toEqual([]);
    expect(none.notChecked).toBe(10);
  });

  it('follows redirects, across hosts, recording the hops and where it ended', async () => {
    const web = makeWeb({
      'https://a.test/old': {status: 301, location: 'https://b.test/mid'},
      'https://b.test/mid': {status: 302, location: '/final'},
      'https://b.test/final': 200,
    });
    const [only] = (await run(web, ['https://a.test/old'])).checked;
    expect(only.status).toBe(200);
    expect(only.finalUrl).toBe('https://b.test/final');
    expect(only.hops.map(h => [h.status, h.location])).toEqual([
      [301, 'https://b.test/mid'],
      [302, 'https://b.test/final'],
    ]);
  });

  it('stops after three redirect hops and says so, never looping forever', async () => {
    const routes = {};
    for (let i = 0; i < 20; i++) {
      routes[`https://loop.test/${i}`] = {status: 301, location: `/${i + 1}`};
    }
    const web = makeWeb(routes);
    const [only] = (await run(web, ['https://loop.test/0'])).checked;
    expect(only.error).toBe('TOO_MANY_REDIRECTS');
    expect(web.requests.length).toBe(MAX_HOPS + 1);
    const loop = makeWeb({
      'https://a.test/a': {status: 301, location: 'https://a.test/b'},
      'https://a.test/b': {status: 301, location: 'https://a.test/a'},
    });
    expect((await run(loop, ['https://a.test/a'])).checked[0].error).toBe('TOO_MANY_REDIRECTS');
  });

  it('stops at a redirect to another scheme or with a location that is not a URL', async () => {
    const web = makeWeb({
      'https://a.test/x': {status: 302, location: 'javascript:alert(1)'},
      'https://b.test/y': {status: 302, location: 'http://[bad'},
    });
    const result = await run(web, ['https://a.test/x', 'https://b.test/y']);
    expect(web.requests).toHaveLength(2);
    expect(result.checked.every(c => c.status === 302 && c.error === null)).toBe(true);
  });

  it('records why a request failed as a short code, and moves on', async () => {
    const web = makeWeb({
      'https://a.test/': err('ENOTFOUND'),
      'https://b.test/': err('ECONNREFUSED'),
      'https://c.test/': new Error('request to https://c.test/ timed out after 5000ms'),
      'https://d.test/': err('CERT_HAS_EXPIRED'),
      'https://e.test/': new Error(
        'refusing to connect to "e.test": resolves to a private/reserved address (10.0.0.1).'
      ),
      'https://f.test/': err('ECONNRESET'),
      'https://g.test/': new Error('something odd'),
      'https://h.test/': err('EAI_AGAIN'),
    });
    const result = await run(
      web,
      Object.keys({
        'https://a.test/': 1,
        'https://b.test/': 1,
        'https://c.test/': 1,
        'https://d.test/': 1,
        'https://e.test/': 1,
        'https://f.test/': 1,
        'https://g.test/': 1,
        'https://h.test/': 1,
      })
    );
    const byUrl = Object.fromEntries(result.checked.map(c => [c.url, c.error]));
    expect(byUrl).toEqual({
      'https://a.test/': 'ENOTFOUND',
      'https://b.test/': 'ECONNREFUSED',
      'https://c.test/': 'TIMEOUT',
      'https://d.test/': 'TLS',
      'https://e.test/': 'PRIVATE',
      'https://f.test/': 'ECONNRESET',
      'https://g.test/': 'OTHER',
      'https://h.test/': 'EAI_AGAIN',
    });
    expect(result.checked.every(c => c.status === null)).toBe(true);
  });

  it('stops starting new requests when the total budget is spent, and counts them as not checked', async () => {
    const web = makeWeb();
    web.msPerRequest = 6_000;
    const urls = Array.from({length: 40}, (_, i) => `https://h${i}.test/`);
    const result = await run(web, urls);
    expect(BUDGET_MS).toBe(15_000);
    expect(result.checked.length + result.notChecked).toBe(40);
    expect(result.notChecked).toBeGreaterThan(0);
    expect(web.requests.length).toBeLessThan(40);
  });

  it('never throws: bad input, a fetch that throws at once, or a fetch that returns nonsense', async () => {
    for (const links of [null, undefined, 5, [null, {}, {url: 5}, {url: ''}]]) {
      // @ts-expect-error - deliberately malformed
      await expect(checkExternalLinks({links, limit: 10})).resolves.toEqual({
        checked: [],
        notChecked: 0,
      });
    }
    const sync = await checkExternalLinks({
      links: [{url: 'https://a.test/'}],
      limit: 5,
      fetchPage: /** @type {any} */ (
        () => {
          throw new Error('boom');
        }
      ),
    });
    expect(sync.checked[0].error).toBe('OTHER');
    const odd = await checkExternalLinks({
      links: [{url: 'https://a.test/'}],
      limit: 5,
      fetchPage: /** @type {any} */ (async () => ({status: 200})),
    });
    expect(odd.checked[0].status).toBe(200);
  });
});

describe('errorCodeOf', () => {
  it('maps Node error codes, TLS codes, private refusals and timeouts', () => {
    expect(errorCodeOf(err('ENOTFOUND'))).toBe('ENOTFOUND');
    expect(errorCodeOf(err('UNABLE_TO_VERIFY_LEAF_SIGNATURE'))).toBe('TLS');
    expect(errorCodeOf(err('DEPTH_ZERO_SELF_SIGNED_CERT'))).toBe('TLS');
    expect(errorCodeOf(new Error('refusing to fetch "x": a private/reserved IP address'))).toBe(
      'PRIVATE'
    );
    expect(errorCodeOf(new Error('fetch timed out'))).toBe('TIMEOUT');
    expect(errorCodeOf('weird')).toBe('OTHER');
    expect(errorCodeOf(null)).toBe('OTHER');
  });
});
