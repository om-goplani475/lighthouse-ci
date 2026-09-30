/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  SAMPLE_SIZE_ENV,
  DEFAULT_SAMPLE_SIZE,
  MAX_SAMPLE_SIZE,
  resolveSampleSize,
  pickEvenly,
  collectEligibleUrls,
  checkUrls,
  collectUrlSample,
  describeCheck,
} = require('../../src/lib/sitemap-url-sample.js');
const {emptyDocument} = require('../../src/lib/sitemap-parse.js');

describe('resolveSampleSize', () => {
  it('defaults to 10 when unset', () => {
    expect(resolveSampleSize({})).toBe(DEFAULT_SAMPLE_SIZE);
    expect(DEFAULT_SAMPLE_SIZE).toBe(10);
  });

  it.each([
    ['5', 5],
    ['25', 25],
    [' 7 ', 7],
    ['1', 1],
    ['0', 1],
    ['26', MAX_SAMPLE_SIZE],
    ['9999', MAX_SAMPLE_SIZE],
  ])('reads %j as %i, clamped to 1..25', (raw, expected) => {
    expect(resolveSampleSize({[SAMPLE_SIZE_ENV]: raw})).toBe(expected);
  });

  it.each([[''], ['abc'], ['-3'], ['4.5'], ['1e2'], ['10 urls']])(
    'falls back to the default for %j',
    raw => {
      expect(resolveSampleSize({[SAMPLE_SIZE_ENV]: raw})).toBe(DEFAULT_SAMPLE_SIZE);
    }
  );
});

describe('pickEvenly', () => {
  const range = n => Array.from({length: n}, (_, i) => i);

  it('returns everything when there are no more items than the sample size', () => {
    expect(pickEvenly(range(4), 10)).toEqual([0, 1, 2, 3]);
    expect(pickEvenly(range(10), 10)).toEqual(range(10));
  });

  it('always includes the first and last item and spreads the rest evenly', () => {
    const picked = pickEvenly(range(100), 5);
    expect(picked).toEqual([0, 25, 50, 74, 99]);
  });

  it('is deterministic', () => {
    expect(pickEvenly(range(1000), 10)).toEqual(pickEvenly(range(1000), 10));
  });

  it('returns exactly n distinct items for a large list, and handles n of 1 and 2', () => {
    const picked = pickEvenly(range(50_001), 25);
    expect(picked).toHaveLength(25);
    expect(new Set(picked).size).toBe(25);
    expect(pickEvenly(range(50), 1)).toEqual([0]);
    expect(pickEvenly(range(50), 2)).toEqual([0, 49]);
  });

  it('does not repeat an item when the list is only slightly larger than n', () => {
    const picked = pickEvenly(range(11), 10);
    expect(new Set(picked).size).toBe(picked.length);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBe(10);
  });
});

describe('collectEligibleUrls', () => {
  const doc = (url, locs, overrides = {}) => ({
    ...emptyDocument({url, source: 'declared', parentUrl: null}),
    status: 200,
    kind: 'urlset',
    locs,
    entryCount: locs.length,
    ...overrides,
  });

  it('collects same-origin URLs from urlset documents in order, de-duplicated across files', () => {
    const {urls, skippedCrossOrigin} = collectEligibleUrls([
      doc('https://example.com/s1.xml', ['https://example.com/a', 'https://example.com/b']),
      doc('https://example.com/s2.xml', ['https://example.com/b', 'https://example.com/c']),
    ]);
    expect(urls).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
    expect(skippedCrossOrigin).toBe(0);
  });

  it('never requests a URL on another host, scheme or port, and counts it as skipped', () => {
    const {urls, skippedCrossOrigin} = collectEligibleUrls([
      doc('https://example.com/s.xml', [
        'https://example.com/ok',
        'https://evil.test/x',
        'http://example.com/http-not-https',
        'https://example.com:8443/other-port',
        'https://www.example.com/www',
      ]),
    ]);
    expect(urls).toEqual(['https://example.com/ok']);
    expect(skippedCrossOrigin).toBe(4);
  });

  it('ignores an index, a failed fetch, and an unparsed document', () => {
    const {urls} = collectEligibleUrls([
      doc('https://example.com/i.xml', ['https://example.com/child.xml'], {kind: 'sitemapindex'}),
      doc('https://example.com/f.xml', ['https://example.com/x'], {
        outcome: 'http-error',
        kind: null,
      }),
      doc('https://example.com/u.xml', [], {kind: null}),
    ]);
    expect(urls).toEqual([]);
  });
});

describe('checkUrls', () => {
  const ok = status => async () => ({status});

  it('returns a result per URL in input order', async () => {
    const results = await checkUrls(['https://e.com/a', 'https://e.com/b', 'https://e.com/c'], {
      fetchStatus: async url => ({status: url.endsWith('b') ? 404 : 200}),
    });
    expect(results.map(r => [r.url.slice(-1), r.status])).toEqual([
      ['a', 200],
      ['b', 404],
      ['c', 200],
    ]);
  });

  it('records a redirect with its target, without following it', async () => {
    const calls = [];
    const [result] = await checkUrls(['https://e.com/old'], {
      fetchStatus: async url => {
        calls.push(url);
        return {status: 301, redirectLocation: 'https://e.com/new'};
      },
    });
    expect(result).toMatchObject({status: 301, redirectLocation: 'https://e.com/new', error: null});
    expect(calls).toEqual(['https://e.com/old']);
  });

  it('never runs more requests at once than the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const urls = Array.from({length: 20}, (_, i) => `https://e.com/${i}`);
    await checkUrls(urls, {
      concurrency: 5,
      fetchStatus: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return {status: 200};
      },
    });
    expect(peak).toBe(5);
  });

  it('retries a network error once, and succeeds if the retry works', async () => {
    let attempts = 0;
    const [result] = await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('ECONNRESET');
        return {status: 200};
      },
    });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({status: 200, error: null});
  });

  it('gives up after one retry and records the error', async () => {
    let attempts = 0;
    const [result] = await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => {
        attempts += 1;
        throw new Error('ECONNREFUSED');
      },
    });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({status: null, error: 'ECONNREFUSED'});
  });

  it('does not retry an HTTP error status', async () => {
    let attempts = 0;
    await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => {
        attempts += 1;
        return {status: 500};
      },
    });
    expect(attempts).toBe(1);
  });

  it('enforces a hard per-request timeout even if the fetcher never settles', async () => {
    const started = Date.now();
    const [result] = await checkUrls(['https://e.com/hang'], {
      fetchStatus: () => new Promise(() => {}),
      timeoutMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.error).toMatch(/timed out after 50ms/);
  });

  it('stops starting requests once the total budget is used, marking the rest not checked', async () => {
    let clock = 0;
    const started = [];
    const urls = ['a', 'b', 'c', 'd'].map(x => `https://e.com/${x}`);
    const results = await checkUrls(urls, {
      concurrency: 1,
      budgetMs: 100,
      now: () => clock,
      fetchStatus: async url => {
        started.push(url);
        clock += 60; // each request "takes" 60 ms
        return {status: 200};
      },
    });
    expect(started).toEqual([urls[0], urls[1]]);
    expect(results.map(r => r.notChecked)).toEqual([false, false, true, true]);
  });

  it('handles an empty list', async () => {
    expect(await checkUrls([], {fetchStatus: ok(200)})).toEqual([]);
  });
});

describe('checkUrls — fetcher fields pass through as `response`', () => {
  it('keeps everything the fetcher resolved, untouched, alongside the existing fields', async () => {
    const extra = {
      status: 200,
      redirectLocation: null,
      headers: {'x-robots-tag': ['noindex']},
      body: Buffer.from('hi'),
      bodyRead: 'html',
    };
    const [result] = await checkUrls(['https://e.com/a'], {fetchStatus: async () => extra});
    expect(result).toMatchObject({
      url: 'https://e.com/a',
      status: 200,
      redirectLocation: null,
      error: null,
      notChecked: false,
    });
    expect(result.response).toBe(extra);
  });

  it('gives a plain {status} fetcher a plain {status} response', async () => {
    const [result] = await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => ({status: 404}),
    });
    expect(result.response).toEqual({status: 404});
  });

  it('has no response for an errored or not-checked URL', async () => {
    const [errored] = await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => {
        throw new Error('boom');
      },
    });
    expect(errored.response).toBeUndefined();
    const [skipped] = await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => ({status: 200}),
      budgetMs: 0,
    });
    expect(skipped).toMatchObject({notChecked: true});
    expect(skipped.response).toBeUndefined();
  });

  it("keeps only the successful attempt's response when a retry succeeds after an error", async () => {
    let attempts = 0;
    const [result] = await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('ECONNRESET');
        return {status: 200, marker: 'second'};
      },
    });
    expect(result.error).toBeNull();
    expect(result.response).toEqual({status: 200, marker: 'second'});
  });

  it('does not leave a stale response when the retry fails after a response-less first error', async () => {
    let attempts = 0;
    const [result] = await checkUrls(['https://e.com/a'], {
      fetchStatus: async () => {
        attempts += 1;
        throw new Error(`fail ${attempts}`);
      },
    });
    expect(result.error).toBe('fail 2');
    expect(result.response).toBeUndefined();
  });
});

describe('collectUrlSample', () => {
  const urlsetDoc = (locs, url = 'https://example.com/sitemap.xml') => ({
    ...emptyDocument({url, source: 'declared', parentUrl: null}),
    status: 200,
    kind: 'urlset',
    locs,
    entryCount: locs.length,
  });
  const pages = n => Array.from({length: n}, (_, i) => `https://example.com/p${i}`);

  /** A page-fetcher result shaped like safeFetchPrefix's. */
  const page = (overrides = {}) => ({
    status: 200,
    redirectLocation: null,
    headers: {
      'x-robots-tag': [],
      'content-type': ['text/html; charset=utf-8'],
      'content-encoding': [],
      location: [],
    },
    body: Buffer.from('<html><head><title>T</title></head><body>x</body></html>'),
    bodyRead: 'html',
    truncated: false,
    ...overrides,
  });

  const collect = (documents, fetchPage, deps = {}) =>
    collectUrlSample(documents, {fetchPage, env: {}, ...deps});

  it('returns null when there is no eligible URL', async () => {
    expect(await collect([], async () => page())).toBeNull();
    expect(await collect([urlsetDoc(['https://other.test/a'])], async () => page())).toBeNull();
    expect(
      await collect([{...urlsetDoc(['https://example.com/a']), kind: 'sitemapindex'}], async () =>
        page()
      )
    ).toBeNull();
  });

  it('records how the sample was drawn: size, eligible count, other-host skips', async () => {
    const sample = await collect(
      [urlsetDoc([...pages(30), 'https://other.test/x'])],
      async () => page(),
      {env: {LHCI_SEO_SITEMAP_SAMPLE_SIZE: '4'}}
    );
    expect(sample).toMatchObject({sampleSize: 4, eligibleCount: 30, skippedCrossOrigin: 1});
    expect(sample.pages).toHaveLength(4);
    expect(sample.pages[0].url).toBe('https://example.com/p0');
    expect(sample.pages[3].url).toBe('https://example.com/p29');
  });

  it('defaults to 10 and caps at 25, from the environment', async () => {
    expect((await collect([urlsetDoc(pages(100))], async () => page())).pages).toHaveLength(10);
    const big = await collect([urlsetDoc(pages(100))], async () => page(), {
      env: {LHCI_SEO_SITEMAP_SAMPLE_SIZE: '500'},
    });
    expect(big.sampleSize).toBe(25);
    expect(big.pages).toHaveLength(25);
  });

  it('extracts head signals for an HTML page and carries its headers', async () => {
    const html =
      '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="/c"></head><body>x</body></html>';
    const sample = await collect([urlsetDoc(['https://example.com/a'])], async () =>
      page({
        body: Buffer.from(html),
        headers: {
          'x-robots-tag': ['googlebot: noindex'],
          'content-type': ['text/html'],
          'content-encoding': [],
          location: [],
        },
      })
    );
    expect(sample.pages[0]).toEqual({
      url: 'https://example.com/a',
      status: 200,
      redirectLocation: null,
      error: null,
      notChecked: false,
      contentType: 'text/html',
      xRobotsTag: ['googlebot: noindex'],
      bodyRead: 'html',
      truncated: false,
      metas: [{name: 'robots', content: 'noindex'}],
      canonicals: ['/c'],
      headComplete: true,
    });
  });

  it('passes the truncated flag to the extractor: a cut-off head is not complete', async () => {
    const sample = await collect([urlsetDoc(['https://example.com/a'])], async () =>
      page({body: Buffer.from('<html><head><title>T</title><script>var x=1;'), truncated: true})
    );
    expect(sample.pages[0]).toMatchObject({truncated: true, headComplete: false, metas: []});
  });

  it.each([
    [
      'a PDF',
      {
        bodyRead: 'skipped-not-html',
        body: Buffer.alloc(0),
        headers: {
          'x-robots-tag': ['noindex'],
          'content-type': ['application/pdf'],
          'content-encoding': [],
          location: [],
        },
      },
    ],
    [
      'a compressed page',
      {
        bodyRead: 'skipped-compressed',
        body: Buffer.alloc(0),
        headers: {
          'x-robots-tag': [],
          'content-type': ['text/html'],
          'content-encoding': ['gzip'],
          location: [],
        },
      },
    ],
  ])('keeps headers but no signals for %s', async (_label, overrides) => {
    const sample = await collect([urlsetDoc(['https://example.com/a'])], async () =>
      page(overrides)
    );
    expect(sample.pages[0]).toMatchObject({
      status: 200,
      bodyRead: overrides.bodyRead,
      metas: [],
      canonicals: [],
      headComplete: false,
    });
    expect(sample.pages[0].xRobotsTag).toEqual(overrides.headers['x-robots-tag']);
  });

  it('records a 404 and a redirect from their status, with no signals', async () => {
    const sample = await collect(
      [urlsetDoc(['https://example.com/gone', 'https://example.com/moved'])],
      async url =>
        url.endsWith('gone')
          ? page({status: 404, bodyRead: 'skipped-status', body: Buffer.alloc(0)})
          : page({
              status: 301,
              redirectLocation: 'https://example.com/new',
              bodyRead: 'skipped-status',
              body: Buffer.alloc(0),
            })
    );
    expect(sample.pages.map(p => [p.status, p.redirectLocation, p.bodyRead])).toEqual([
      [404, null, 'skipped-status'],
      [301, 'https://example.com/new', 'skipped-status'],
    ]);
  });

  it('records an error and a not-checked page without signals', async () => {
    let clock = 0;
    const sample = await collect(
      [urlsetDoc(pages(3))],
      async url => {
        clock += 40_000;
        if (url.endsWith('p0')) throw new Error('ECONNREFUSED');
        return page();
      },
      {now: () => clock}
    );
    // p0 fails twice (retry) and takes the whole budget; the rest are not checked.
    expect(sample.pages[0]).toMatchObject({
      error: 'ECONNREFUSED',
      status: null,
      bodyRead: null,
      metas: [],
      headComplete: false,
    });
    expect(sample.pages[1]).toMatchObject({notChecked: true, status: null, bodyRead: null});
  });

  it('accepts a plain {status} fetcher, producing empty signals', async () => {
    const sample = await collect([urlsetDoc(['https://example.com/a'])], async () => ({
      status: 200,
    }));
    expect(sample.pages[0]).toMatchObject({
      status: 200,
      contentType: null,
      xRobotsTag: [],
      bodyRead: null,
      metas: [],
      canonicals: [],
    });
  });

  it('never keeps a raw body: the serialized sample contains none of the page text', async () => {
    const secret = 'SECRET-BODY-TEXT-1234567890';
    const sample = await collect([urlsetDoc(['https://example.com/a'])], async () =>
      page({
        body: Buffer.from(
          `<html><head><meta name="robots" content="noindex"></head><body>${secret}</body></html>`
        ),
      })
    );
    expect(JSON.stringify(sample)).not.toContain(secret);
    expect(JSON.stringify(sample)).not.toContain('<body>');
  });

  it('requests each sampled URL exactly once (no request beyond the sample)', async () => {
    const seen = [];
    await collect([urlsetDoc(pages(50))], async url => {
      seen.push(url);
      return page();
    });
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });
});

describe('describeCheck', () => {
  const base = {url: 'u', status: 200, redirectLocation: null, error: null, notChecked: false};
  it.each([
    [{}, 'HTTP 200'],
    [{status: 404}, 'HTTP 404'],
    [{status: 301, redirectLocation: 'https://e.com/n'}, 'HTTP 301, redirects to https://e.com/n'],
    [{status: null, error: 'boom'}, 'could not be fetched: boom'],
    [{status: null, notChecked: true}, 'not checked (time budget used up)'],
  ])('%j', (override, expected) => {
    expect(describeCheck({...base, ...override})).toBe(expected);
  });
});
