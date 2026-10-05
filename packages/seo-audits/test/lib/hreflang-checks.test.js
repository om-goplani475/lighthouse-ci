/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  checkAlternates,
  MAX_BYTES,
  TIMEOUT_MS,
  CONCURRENCY,
} = require('../../src/lib/hreflang-checks.js');
const {USER_AGENT} = require('../../src/lib/crawl-snapshot.js');

const PAGE = 'https://example.com/en/';
const html = (/** @type {string} */ head) =>
  `<!doctype html><html><head>${head}</head><body>x</body></html>`;
const back = '<link rel="alternate" hreflang="en" href="https://example.com/en/">';
const reply = (/** @type {string} */ body, over = {}) => ({
  status: 200,
  redirectLocation: null,
  headers: {
    'x-robots-tag': [],
    'content-type': ['text/html'],
    'content-encoding': [],
    location: [],
  },
  body: Buffer.from(body),
  bodyRead: 'html',
  truncated: false,
  ...over,
});
const alt = (/** @type {string} */ hreflang, /** @type {string} */ href) => ({hreflang, href});

describe('checkAlternates', () => {
  it('requests each alternate with the bounds and user-agent, never the page itself, and reads its head', async () => {
    const fetchSame = jest.fn(async () =>
      reply(
        html(
          `${back}<link rel="alternate" hreflang="fr" href="/fr/"><link rel="canonical" href="https://example.com/fr/"><meta name="robots" content="noindex">`
        )
      )
    );
    // @ts-expect-error - partial fetch results
    const {results, notChecked} = await checkAlternates({
      pageUrl: PAGE,
      alternates: [alt('en', PAGE), alt('fr', 'https://example.com/fr/')],
      limit: 10,
      fetchSame,
    });
    expect(notChecked).toBe(0);
    expect(fetchSame).toHaveBeenCalledTimes(1);
    expect(fetchSame).toHaveBeenCalledWith('https://example.com/fr/', {
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      userAgent: USER_AGENT,
    });
    expect(results[0]).toMatchObject({
      url: 'https://example.com/fr/',
      hreflang: 'fr',
      sameOrigin: true,
      status: 200,
      noindex: true,
      canonicals: ['https://example.com/fr/'],
      hasHreflang: true,
    });
    expect(results[0].alternates).toHaveLength(2);
  });

  it('sends other hosts through the public-only fetch and the same origin through the normal one', async () => {
    const fetchSame = jest.fn(async () => reply(html('')));
    const fetchPublic = jest.fn(async () => reply(html('')));
    // @ts-expect-error - partial fetch results
    const {results} = await checkAlternates({
      pageUrl: PAGE,
      alternates: [alt('de', 'https://example.de/'), alt('fr', 'https://example.com/fr/')],
      limit: 10,
      fetchSame,
      fetchPublic,
    });
    expect(fetchPublic).toHaveBeenCalledWith('https://example.de/', expect.any(Object));
    expect(fetchSame).toHaveBeenCalledWith('https://example.com/fr/', expect.any(Object));
    expect(results.map(r => r.sameOrigin)).toEqual([false, true]);
  });

  it('dedupes by loose key, skips junk, applies the limit and counts what it left', async () => {
    const fetchSame = jest.fn(async () => reply(html('')));
    // @ts-expect-error - partial fetch results
    const {results, notChecked} = await checkAlternates({
      pageUrl: PAGE,
      alternates: [
        alt('fr', 'https://example.com/fr'),
        alt('fr-CA', 'https://example.com/fr/'),
        alt('es', 'https://example.com/es/'),
        alt('it', 'https://example.com/it/'),
        alt('x', 'ftp://example.com/'),
        alt('y', 'not a url'),
      ],
      limit: 2,
      fetchSame,
    });
    expect(results).toHaveLength(2);
    expect(notChecked).toBe(1);
  });

  it('records errors, redirects and non-HTML answers as data', async () => {
    const fetchSame = jest.fn(async (/** @type {string} */ url) => {
      if (url.includes('/down')) {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), {code: 'ENOTFOUND'});
      }
      if (url.includes('/moved')) {
        return reply('', {status: 301, redirectLocation: '/new', bodyRead: 'skipped-status'});
      }
      return reply('%PDF', {
        bodyRead: 'skipped-not-html',
        headers: {
          'x-robots-tag': ['noindex'],
          'content-type': ['application/pdf'],
          'content-encoding': [],
          location: [],
        },
      });
    });
    // @ts-expect-error - partial fetch results
    const {results} = await checkAlternates({
      pageUrl: PAGE,
      alternates: [
        alt('a', 'https://example.com/down'),
        alt('b', 'https://example.com/moved'),
        alt('c', 'https://example.com/file'),
      ],
      limit: 10,
      fetchSame,
    });
    expect(results[0]).toMatchObject({error: 'ENOTFOUND', status: null});
    expect(results[1]).toMatchObject({status: 301, redirectLocation: '/new', hasHreflang: false});
    expect(results[2]).toMatchObject({
      status: 200,
      bodyRead: 'skipped-not-html',
      noindex: true,
      alternates: [],
    });
  });

  it('asks one request at a time per host and stops at the time budget, counting the rest', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchSame = jest.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return reply(html(''));
    });
    // @ts-expect-error - partial fetch results
    await checkAlternates({
      pageUrl: PAGE,
      alternates: ['a', 'b', 'c', 'd'].map(p => alt(p, `https://example.com/${p}/`)),
      limit: 10,
      fetchSame,
    });
    expect(peak).toBe(1);

    let clock = 0;
    const ticking = jest.fn(async () => {
      clock += 15_000;
      return reply(html(''));
    });
    // @ts-expect-error - partial fetch results
    const late = await checkAlternates({
      pageUrl: PAGE,
      alternates: ['a', 'b', 'c'].map(p => alt(p, `https://example.com/${p}/`)),
      limit: 10,
      fetchSame: ticking,
      now: () => clock,
    });
    expect(late.results).toHaveLength(2);
    expect(late.notChecked).toBe(1);
    expect(CONCURRENCY).toBe(5);
  });

  it('never throws on bad input', async () => {
    // @ts-expect-error - deliberately wrong input
    expect(await checkAlternates({pageUrl: 'not a url', alternates: null, limit: 3})).toEqual({
      results: [],
      notChecked: 0,
    });
    // @ts-expect-error - deliberately wrong input
    expect(
      (await checkAlternates({pageUrl: PAGE, alternates: [null, {}], limit: 3})).results
    ).toEqual([]);
  });
});
