/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {collectSoft404Probe, skippedWarning} = require('../../src/gatherers/soft-404-probe.js');

const PAGE = {finalDisplayedUrl: 'https://example.com/deep/page?x=1#top'};

/**
 * @param {Record<string, {status: number, redirectLocation?: string} | Error>} routes by full URL
 */
const collect = async routes => {
  /** @type {Array<[string, any]>} */
  const calls = [];
  const fetchStatus = async (/** @type {string} */ url, /** @type {any} */ options) => {
    calls.push([url, options]);
    const route = routes[url] || routes['*'];
    if (route instanceof Error) throw route;
    if (!route) throw new Error(`unexpected request to ${url}`);
    return route;
  };
  const artifact = await collectSoft404Probe(PAGE, {fetchStatus, random: () => 'tok'});
  return {artifact, calls};
};

const TOP = 'https://example.com/lhci-seo-probe-tok';
const NESTED = 'https://example.com/lhci-seo-probe-tok/page.html';

describe('collectSoft404Probe', () => {
  it('requests the two made-up URLs on the page origin only, with a 5 s timeout each', async () => {
    const {calls} = await collect({'*': {status: 404}});
    expect(calls.map(c => c[0]).sort()).toEqual([NESTED, TOP].sort());
    for (const [, options] of calls) expect(options).toEqual({timeoutMs: 5000});
  });

  it('records a correct 404 site', async () => {
    const {artifact} = await collect({'*': {status: 404}});
    expect(artifact.origin).toBe('https://example.com');
    expect(artifact.unavailableReason).toBeNull();
    expect(artifact.probes.map(p => p.outcome)).toEqual(['not-found', 'not-found']);
  });

  it('records a catch-all site as soft 404', async () => {
    const {artifact} = await collect({'*': {status: 200}});
    expect(artifact.probes.map(p => p.outcome)).toEqual(['soft-404', 'soft-404']);
  });

  it('follows a same-origin redirect exactly once and records where it led', async () => {
    const {artifact, calls} = await collect({
      [TOP]: {status: 301, redirectLocation: '/'},
      [NESTED]: {status: 404},
      'https://example.com/': {status: 200},
    });
    expect(artifact.probes[0]).toMatchObject({
      outcome: 'redirect-to-page',
      status: 301,
      targetStatus: 200,
      location: 'https://example.com/',
    });
    expect(calls.map(c => c[0])).toHaveLength(3);
  });

  it('stops after one hop: a redirect that redirects again is not followed further', async () => {
    const {artifact, calls} = await collect({
      [TOP]: {status: 301, redirectLocation: '/a'},
      [NESTED]: {status: 404},
      'https://example.com/a': {status: 301, redirectLocation: '/b'},
    });
    expect(artifact.probes[0].outcome).toBe('redirect-chain');
    expect(calls.map(c => c[0])).not.toContain('https://example.com/b');
  });

  it('survives a redirect loop to itself with a single extra request', async () => {
    const {artifact, calls} = await collect({
      [TOP]: {status: 302, redirectLocation: TOP},
      [NESTED]: {status: 404},
    });
    expect(artifact.probes[0].outcome).toBe('redirect-chain');
    expect(calls).toHaveLength(3);
  });

  it('never requests a redirect target on another origin', async () => {
    const {artifact, calls} = await collect({
      [TOP]: {status: 302, redirectLocation: 'http://169.254.169.254/latest/meta-data/'},
      [NESTED]: {status: 302, redirectLocation: 'https://evil.test/x'},
    });
    expect(artifact.probes.map(p => p.outcome)).toEqual([
      'redirect-elsewhere',
      'redirect-elsewhere',
    ]);
    expect(calls.map(c => c[0]).sort()).toEqual([NESTED, TOP].sort());
  });

  it('records a failed probe as data and keeps the other', async () => {
    const {artifact} = await collect({
      [TOP]: new Error('timed out'),
      [NESTED]: {status: 404},
    });
    expect(artifact.probes.map(p => p.outcome)).toEqual(['failed', 'not-found']);
    expect(artifact.probes[0].reason).toBe('timed out');
    expect(artifact.unavailableReason).toBeNull();
  });

  it('is unavailable, with the reason, when both probes fail', async () => {
    const {artifact} = await collect({'*': new Error('refusing to fetch: private address')});
    expect(artifact.unavailableReason).toMatch(/private address/);
    expect(skippedWarning(artifact)).toMatch(/^The soft-404 check was skipped: refusing/);
  });

  it('records a failure while requesting the redirect target', async () => {
    const {artifact} = await collect({
      [TOP]: {status: 301, redirectLocation: '/'},
      [NESTED]: {status: 404},
      'https://example.com/': new Error('reset'),
    });
    expect(artifact.probes[0].outcome).toBe('failed');
    expect(artifact.probes[0].reason).toMatch(/redirect target .* could not be requested: reset/);
  });

  it('cuts an enormous error message', async () => {
    const {artifact} = await collect({'*': new Error('x'.repeat(100_000))});
    expect((artifact.unavailableReason || '').length).toBeLessThan(400);
  });

  it('uses a different random token on each call by default', async () => {
    const urls = new Set();
    const fetchStatus = async (/** @type {string} */ url) => {
      urls.add(url);
      return {status: 404};
    };
    await collectSoft404Probe(PAGE, {fetchStatus});
    await collectSoft404Probe(PAGE, {fetchStatus});
    expect(urls.size).toBe(4);
  });

  it('does not warn when the check ran', async () => {
    const {artifact} = await collect({'*': {status: 404}});
    expect(skippedWarning(artifact)).toBeNull();
  });
});
