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
