/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {collectUrlVariants, skippedWarning} = require('../../src/gatherers/url-variants.js');

const PAGE = {finalDisplayedUrl: 'https://example.com/shoes?size=9#top'};

/**
 * @param {Record<string, {status: number, redirectLocation?: string} | Error>} routes
 * @param {string} [page]
 */
const collect = async (routes, page = PAGE.finalDisplayedUrl) => {
  /** @type {string[]} */
  const calls = [];
  const fetchStatus = async (/** @type {string} */ url, /** @type {any} */ options) => {
    calls.push(url);
    expect(options.timeoutMs).toBeLessThanOrEqual(5000);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${url}`), {code: 'ENOTFOUND'});
    return route;
  };
  const artifact = await collectUrlVariants({finalDisplayedUrl: page}, {fetchStatus});
  return {artifact, calls};
};

const AUDITED = 'https://example.com/shoes?size=9';
const byKind = (/** @type {any} */ a, /** @type {string} */ k) =>
  a.variants.find((/** @type {any} */ v) => v.kind === k);

describe('collectUrlVariants', () => {
  it('does not request anything for a page it should skip', async () => {
    const {artifact, calls} = await collect({}, 'https://localhost/');
    expect(calls).toEqual([]);
    expect(artifact.skipped).toMatch(/IP address or local host/);
    expect(artifact.variants).toEqual([]);
  });

  it('records a correct setup: one permanent redirect each, ending at the audited URL', async () => {
    const {artifact} = await collect({
      'http://example.com/shoes?size=9': {status: 301, redirectLocation: AUDITED},
      [AUDITED]: {status: 200},
      'http://www.example.com/shoes?size=9': {status: 301, redirectLocation: AUDITED},
      'https://www.example.com/shoes?size=9': {status: 301, redirectLocation: AUDITED},
    });
    expect(artifact.canonicalOrigin).toBe('https://example.com');
    expect(artifact.skipped).toBeNull();
    for (const v of artifact.variants) {
      expect(v.end).toBe('final');
      expect(v.hops.map(h => h.status)).toEqual([301, 200]);
      expect(v.endUrl).toBe(AUDITED);
    }
  });

  it('follows a relative Location and records every hop in order', async () => {
    const {artifact} = await collect({
      'http://example.com/shoes?size=9': {
        status: 301,
        redirectLocation: 'https://example.com/shoes?size=9',
      },
      [AUDITED]: {status: 200},
    });
    expect(byKind(artifact, 'http-same-host').hops).toEqual([
      {url: 'http://example.com/shoes?size=9', status: 301, location: AUDITED},
      {url: AUDITED, status: 200, location: null},
    ]);
  });

  it('marks a variant that does not exist as unreachable', async () => {
    const {artifact} = await collect({
      'http://example.com/shoes?size=9': {status: 301, redirectLocation: AUDITED},
      [AUDITED]: {status: 200},
    });
    expect(byKind(artifact, 'http-alt-host').end).toBe('unreachable');
    expect(byKind(artifact, 'https-alt-host').end).toBe('unreachable');
  });

  it('marks a timeout or a refusal as failed, not unreachable', async () => {
    const {artifact} = await collect({
      'http://example.com/shoes?size=9': new Error('fetch timed out after 5000ms'),
      'http://www.example.com/shoes?size=9': new Error('refusing to fetch: a private address'),
      'https://www.example.com/shoes?size=9': {status: 200},
    });
    expect(byKind(artifact, 'http-same-host').end).toBe('failed');
    expect(byKind(artifact, 'http-alt-host').end).toBe('failed');
    expect(skippedWarning(artifact)).toMatch(/could not request http:\/\/www.example.com\/shoes/);
  });

  it('detects a loop between two URLs', async () => {
    const {artifact, calls} = await collect({
      'http://example.com/shoes?size=9': {
        status: 301,
        redirectLocation: 'https://example.com/shoes?size=9',
      },
      [AUDITED]: {status: 301, redirectLocation: 'http://example.com/shoes?size=9'},
    });
    const v = byKind(artifact, 'http-same-host');
    expect(v.end).toBe('loop');
    expect(v.endUrl).toBe('http://example.com/shoes?size=9');
    expect(v.hops).toHaveLength(2);
    expect(calls.filter(u => u === AUDITED)).toHaveLength(1);
  });

  it('detects a redirect to itself, ignoring the fragment', async () => {
    const {artifact} = await collect({
      'http://example.com/shoes?size=9': {
        status: 302,
        redirectLocation: 'http://example.com/shoes?size=9#x',
      },
    });
    expect(byKind(artifact, 'http-same-host').end).toBe('loop');
  });

  it('stops at the hop limit on an endless chain of distinct URLs', async () => {
    /** @type {Record<string, any>} */
    const routes = {};
    routes['http://example.com/shoes?size=9'] = {
      status: 301,
      redirectLocation: 'http://example.com/h1',
    };
    for (let i = 1; i < 20; i++) {
      routes[`http://example.com/h${i}`] = {
        status: 301,
        redirectLocation: `http://example.com/h${i + 1}`,
      };
    }
    const {artifact, calls} = await collect(routes);
    const v = byKind(artifact, 'http-same-host');
    expect(v.end).toBe('hop-limit');
    expect(v.hops).toHaveLength(6);
    expect(calls.filter(u => u.startsWith('http://example.com/')).length).toBe(6);
  });

  it('never requests a redirect target outside the site host variants', async () => {
    const {artifact, calls} = await collect({
      'http://example.com/shoes?size=9': {status: 302, redirectLocation: 'https://cdn.evil.test/x'},
      'http://www.example.com/shoes?size=9': {
        status: 302,
        redirectLocation: 'http://169.254.169.254/latest/meta-data/',
      },
      'https://www.example.com/shoes?size=9': {
        status: 302,
        redirectLocation: 'https://example.com.evil.test/',
      },
    });
    for (const v of artifact.variants) expect(v.end).toBe('left-site');
    expect(calls.sort()).toEqual(
      [
        'http://example.com/shoes?size=9',
        'http://www.example.com/shoes?size=9',
        'https://www.example.com/shoes?size=9',
      ].sort()
    );
  });

  it('does not follow a redirect to an allowed host on another port', async () => {
    const {artifact, calls} = await collect({
      'http://example.com/shoes?size=9': {
        status: 301,
        redirectLocation: 'https://example.com:8443/shoes?size=9',
      },
    });
    expect(byKind(artifact, 'http-same-host').end).toBe('left-site');
    expect(calls).not.toContain('https://example.com:8443/shoes?size=9');
  });

  it('records a redirect with a missing, invalid or non-http Location without following it', async () => {
    for (const location of [
      undefined,
      'http://[bad',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ]) {
      const {artifact} = await collect({
        'http://example.com/shoes?size=9': {status: 301, redirectLocation: location},
      });
      const v = byKind(artifact, 'http-same-host');
      expect(['final', 'unresolved-location']).toContain(v.end);
      expect(v.hops).toHaveLength(1);
    }
  });

  it('gives up on a variant whose time budget runs out', async () => {
    let t = 0;
    const fetchStatus = async () => {
      t += 15_000;
      return {status: 301, redirectLocation: 'http://example.com/next'};
    };
    const artifact = await collectUrlVariants(PAGE, {fetchStatus, now: () => t});
    const v = byKind(artifact, 'http-same-host');
    expect(v.end).toBe('failed');
    expect(v.reason).toMatch(/time budget/);
  });

  it('cuts an enormous error message', async () => {
    const {artifact} = await collect({
      'http://example.com/shoes?size=9': new Error('x'.repeat(100_000)),
    });
    expect((byKind(artifact, 'http-same-host').reason || '').length).toBeLessThan(400);
  });

  it('does not warn when nothing was refused', async () => {
    const {artifact} = await collect({
      'http://example.com/shoes?size=9': {status: 301, redirectLocation: AUDITED},
      [AUDITED]: {status: 200},
    });
    expect(skippedWarning(artifact)).toBeNull();
  });
});
