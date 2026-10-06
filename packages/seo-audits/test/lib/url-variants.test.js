/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  planVariants,
  redirectCount,
  judgeConsistency,
  consistencyProduct,
  chainLengthProduct,
  loopProduct,
} = require('../../src/lib/url-variants.js');

describe('planVariants', () => {
  it('probes http, and www toggled over http and https, using the audited path and query', () => {
    const plan = planVariants('https://example.com/shoes/red?size=9#top');
    expect(plan.skipped).toBeNull();
    expect(plan.canonicalOrigin).toBe('https://example.com');
    expect(plan.allowedHosts).toEqual(['example.com', 'www.example.com']);
    expect(plan.specs).toEqual([
      {kind: 'http-same-host', url: 'http://example.com/shoes/red?size=9'},
      {kind: 'http-alt-host', url: 'http://www.example.com/shoes/red?size=9'},
      {kind: 'https-alt-host', url: 'https://www.example.com/shoes/red?size=9'},
    ]);
  });

  it('strips www from a www host', () => {
    const plan = planVariants('https://www.example.com/');
    expect(plan.allowedHosts).toEqual(['www.example.com', 'example.com']);
    expect(plan.specs.map(s => s.url)).toEqual([
      'http://www.example.com/',
      'http://example.com/',
      'https://example.com/',
    ]);
  });

  it('lowercases the host', () => {
    expect(planVariants('https://EXAMPLE.com/').specs[0].url).toBe('http://example.com/');
  });

  it('does not toggle www for a subdomain or a three-label host, but still probes http', () => {
    for (const url of ['https://app.example.com/', 'https://example.co.uk/']) {
      const plan = planVariants(url);
      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].kind).toBe('http-same-host');
    }
  });

  it('does not strip www down to a bare top-level label', () => {
    expect(planVariants('https://www.localdomain/').specs).toHaveLength(1);
  });

  it('skips a page that is not https, uses a port, or is an IP or local host', () => {
    expect(planVariants('http://example.com/').skipped).toMatch(/not served over HTTPS/);
    expect(planVariants('https://example.com:8443/').skipped).toMatch(/non-default port/);
    for (const url of [
      'https://localhost/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://app.localhost/',
      'https://192.168.1.5/',
    ]) {
      const plan = planVariants(url);
      expect(plan.skipped).toMatch(/IP address or local host/);
      expect(plan.specs).toEqual([]);
    }
    expect(planVariants('not a url').skipped).toMatch(/not valid/);
  });
});

const AUDITED = 'https://example.com/shoes?size=9';
const hop = (/** @type {string} */ url, /** @type {number} */ status, location = null) => ({
  url,
  status,
  location,
});
/** @param {Partial<import('../../src/lib/url-variants.js').Variant>} over */
const variant = over => ({
  kind: 'http-same-host',
  startUrl: 'http://example.com/shoes?size=9',
  hops: [],
  end: 'final',
  endUrl: null,
  reason: null,
  ...over,
});
const judge = (/** @type {any} */ v) => judgeConsistency(v, AUDITED, 'https://example.com');

describe('judgeConsistency', () => {
  const good = variant({
    hops: [hop('http://example.com/shoes?size=9', 301, AUDITED), hop(AUDITED, 200)],
  });

  it('accepts a single permanent redirect to the audited URL', () => {
    expect(judge(good)).toMatchObject({verdict: 'ok'});
    expect(judge(good).text).toMatch(/1 redirect\(s\) \(correct\)/);
  });

  it('accepts two redirects (http to www to https) that end at the audited URL', () => {
    const v = variant({
      hops: [
        hop('http://www.example.com/shoes?size=9', 301, 'https://www.example.com/shoes?size=9'),
        hop('https://www.example.com/shoes?size=9', 301, AUDITED),
        hop(AUDITED, 200),
      ],
    });
    expect(judge(v)).toMatchObject({verdict: 'ok'});
  });

  it('notes, but accepts, a temporary redirect', () => {
    for (const status of [302, 303, 307]) {
      const v = variant({
        hops: [hop('http://example.com/shoes?size=9', status, AUDITED), hop(AUDITED, 200)],
      });
      const j = judge(v);
      expect(j.verdict).toBe('ok');
      expect(j.text).toMatch(/temporary redirect/);
    }
    expect(
      judge(
        variant({hops: [hop('http://example.com/shoes?size=9', 308, AUDITED), hop(AUDITED, 200)]})
      ).text
    ).not.toMatch(/temporary/);
  });

  it('fails a variant that serves the page directly', () => {
    const j = judge(variant({hops: [hop('http://example.com/shoes?size=9', 200)]}));
    expect(j.verdict).toBe('fail');
    expect(j.text).toMatch(/Serves the page directly \(HTTP 200\)/);
  });

  it('does not judge a variant that returns an error without redirecting', () => {
    expect(judge(variant({hops: [hop('http://example.com/shoes?size=9', 404)]})).verdict).toBe(
      'note'
    );
    expect(judge(variant({hops: [hop('http://example.com/shoes?size=9', 403)]})).verdict).toBe(
      'note'
    );
  });

  it('fails a chain that ends in an error', () => {
    const v = variant({
      hops: [hop('http://example.com/shoes?size=9', 301, AUDITED), hop(AUDITED, 404)],
    });
    expect(judge(v)).toMatchObject({verdict: 'fail'});
    expect(judge(v).text).toMatch(/ends in HTTP 404/);
  });

  it('fails a chain that ends at a different origin than the audited one', () => {
    const v = variant({
      hops: [
        hop('http://example.com/shoes?size=9', 301, 'http://www.example.com/shoes?size=9'),
        hop('http://www.example.com/shoes?size=9', 200),
      ],
    });
    expect(judge(v)).toMatchObject({verdict: 'fail'});
    expect(judge(v).text).toMatch(/not at the audited origin/);
  });

  it('fails a chain that drops the path or the query', () => {
    for (const end of ['https://example.com/', 'https://example.com/shoes']) {
      const v = variant({hops: [hop('http://example.com/shoes?size=9', 301, end), hop(end, 200)]});
      expect(judge(v)).toMatchObject({verdict: 'fail'});
      expect(judge(v).text).toMatch(/not preserved/);
    }
  });

  it('ignores a trailing slash difference on a non-root path', () => {
    const end = 'https://example.com/shoes/?size=9';
    const v = variant({hops: [hop('http://example.com/shoes?size=9', 301, end), hop(end, 200)]});
    expect(judge(v).verdict).toBe('ok');
  });

  it('skips a variant that does not exist and notes the ones it cannot judge', () => {
    expect(judge(variant({end: 'unreachable', reason: 'ENOTFOUND'})).verdict).toBe('skip');
    expect(judge(variant({end: 'failed', reason: 'timed out'})).verdict).toBe('note');
    expect(judge(variant({end: 'loop'})).text).toMatch(/redirect-loop/);
    expect(judge(variant({end: 'hop-limit'})).text).toMatch(/redirect-chain-length/);
    expect(judge(variant({end: 'unresolved-location', reason: 'no'})).verdict).toBe('note');
    const left = judge(variant({end: 'left-site', endUrl: 'https://cdn.evil.test/'}));
    expect(left.verdict).toBe('note');
    expect(left.text).toMatch(/not one of this site's own host variants/);
  });
});

describe('redirectCount', () => {
  it('counts only the hops that redirected', () => {
    expect(
      redirectCount(variant({hops: [hop('a', 301, 'b'), hop('b', 302, 'c'), hop('c', 200)]}))
    ).toBe(2);
    expect(redirectCount(variant({hops: [hop('a', 200)]}))).toBe(0);
    expect(redirectCount(variant({hops: [hop('a', 301, null)]}))).toBe(0);
  });
});

/** @param {any[]} variants @param {any} [over] */
const artifact = (variants, over = {}) => ({
  audited: AUDITED,
  canonicalOrigin: 'https://example.com',
  variants,
  skipped: null,
  ...over,
});
const goodVariant = variant({
  hops: [hop('http://example.com/shoes?size=9', 301, AUDITED), hop(AUDITED, 200)],
  end: 'final',
  endUrl: AUDITED,
});

describe('the three products are not applicable without usable data', () => {
  for (const [name, fn] of [
    ['consistency', consistencyProduct],
    ['chain length', chainLengthProduct],
    ['loop', loopProduct],
  ]) {
    it(`${name}: missing artifact, skipped, empty`, () => {
      expect(fn(null)).toMatchObject({score: 1, notApplicable: true});
      expect(fn(undefined)).toMatchObject({notApplicable: true});
      expect(
        fn(artifact([], {skipped: 'the page uses a non-default port (8443), x'}))
      ).toMatchObject({
        notApplicable: true,
        explanation: expect.stringMatching(/non-default port/),
      });
      expect(fn(artifact([]))).toMatchObject({notApplicable: true});
    });
  }
});

describe('consistencyProduct', () => {
  it('passes when every reachable variant redirects to the audited URL', () => {
    const p = consistencyProduct(
      artifact([goodVariant, variant({kind: 'http-alt-host', end: 'unreachable'})])
    );
    expect(p.score).toBe(1);
    expect(/** @type {any} */ (p.details).items).toHaveLength(2);
  });

  it('fails when a variant serves directly, naming how many', () => {
    const p = consistencyProduct(
      artifact([
        goodVariant,
        variant({
          kind: 'https-alt-host',
          hops: [hop('https://www.example.com/shoes?size=9', 200)],
          endUrl: 'x',
        }),
      ])
    );
    expect(p.score).toBe(0);
    expect(p.explanation).toMatch(/1 of 2 other form/);
  });

  it('is not applicable when no other form exists', () => {
    const p = consistencyProduct(
      artifact([
        variant({end: 'unreachable'}),
        variant({kind: 'http-alt-host', end: 'unreachable'}),
      ])
    );
    expect(p).toMatchObject({notApplicable: true});
    expect(p.explanation).toMatch(/nothing to compare/);
  });

  it('does not fail on notes alone', () => {
    expect(
      consistencyProduct(artifact([variant({end: 'failed', reason: 'timed out'})])).score
    ).toBe(1);
  });
});

describe('chainLengthProduct', () => {
  const chain = (/** @type {number} */ redirects) => {
    const hops = [];
    for (let i = 0; i < redirects; i++) {
      hops.push(hop(`https://example.com/${i}`, 301, `https://example.com/${i + 1}`));
    }
    hops.push(hop(`https://example.com/${redirects}`, 200));
    return variant({hops, end: 'final'});
  };

  it('passes zero, one and two redirects, fails three', () => {
    for (const n of [0, 1, 2]) expect(chainLengthProduct(artifact([chain(n)])).score).toBe(1);
    const p = chainLengthProduct(artifact([chain(3)]));
    expect(p.score).toBe(0.5);
    expect(p.explanation).toMatch(/1 URL variant\(s\) take more than 2 redirects/);
  });

  it('fails a chain that is still redirecting at the hop limit', () => {
    expect(
      chainLengthProduct(artifact([variant({end: 'hop-limit', hops: [hop('a', 301, 'b')]})])).score
    ).toBe(0);
  });

  it('does not count a loop as a long chain', () => {
    const loop = variant({
      end: 'loop',
      hops: [hop('a', 301, 'b'), hop('b', 301, 'c'), hop('c', 301, 'a')],
      endUrl: 'a',
    });
    expect(chainLengthProduct(artifact([loop])).score).toBe(1);
  });

  it('is not applicable when no variant could be requested', () => {
    expect(
      chainLengthProduct(artifact([variant({end: 'unreachable'}), variant({end: 'failed'})]))
    ).toMatchObject({
      notApplicable: true,
    });
  });
});

describe('loopProduct', () => {
  const loop = variant({
    end: 'loop',
    hops: [
      hop('http://example.com/a', 301, 'http://example.com/b'),
      hop('http://example.com/b', 301, 'http://example.com/a'),
    ],
    endUrl: 'http://example.com/a',
  });

  it('fails a loop and shows the cycle', () => {
    const p = loopProduct(artifact([goodVariant, loop]));
    expect(p.score).toBe(0);
    expect(p.explanation).toMatch(/1 URL variant\(s\) redirect in a loop/);
    const items = /** @type {any} */ (p.details).items;
    expect(items[1].chain).toMatch(/back to http:\/\/example.com\/a/);
  });

  it('passes when nothing loops', () => {
    expect(loopProduct(artifact([goodVariant])).score).toBe(1);
  });

  it('is not applicable when nothing could be requested', () => {
    expect(loopProduct(artifact([variant({end: 'unreachable'})]))).toMatchObject({
      notApplicable: true,
    });
  });

  it('cuts an enormous URL in the chain it shows', () => {
    const huge = variant({
      end: 'loop',
      hops: [hop(`http://example.com/${'a'.repeat(200_000)}`, 301, 'x')],
      endUrl: 'y',
    });
    const items = /** @type {any} */ (loopProduct(artifact([huge])).details).items;
    expect(items[0].chain.length).toBeLessThan(1_200);
  });
});
