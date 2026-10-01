/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {collectIndexabilitySignals} = require('../../src/gatherers/indexability-signals.js');

const PAGE = 'https://example.com/shoes';

/**
 * @param {{status?: number, location?: string, body?: string, headers?: any} | Error | null} route
 */
const run = async (page, route, pageUrl = PAGE) => {
  /** @type {string[]} */
  const calls = [];
  const fetchPage = async (/** @type {string} */ url) => {
    calls.push(url);
    if (route instanceof Error) throw route;
    const r = route || {};
    const body = Buffer.from(r.body ?? '<html><head></head><body>x</body></html>');
    return {
      status: r.status ?? 200,
      redirectLocation: r.location ?? null,
      headers: {
        'x-robots-tag': [],
        'content-type': ['text/html'],
        'content-encoding': [],
        location: r.location ? [r.location] : [],
        ...r.headers,
      },
      body,
      bodyRead: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300 ? 'html' : 'skipped-status',
      truncated: false,
    };
  };
  const artifact = await collectIndexabilitySignals(page, pageUrl, {fetchPage});
  return {artifact, calls};
};

describe('collectIndexabilitySignals', () => {
  it('makes no request without a canonical, or with a self or trailing-slash canonical', async () => {
    for (const canonicals of [[], [PAGE], [`${PAGE}/`], [`${PAGE}#x`]]) {
      const {artifact, calls} = await run({canonicals, bodyTextLength: 300}, null);
      expect(calls).toEqual([]);
      expect(artifact.target).toBeNull();
      expect(artifact.targetSkipped).toBeNull();
      expect(artifact.bodyTextLength).toBe(300);
    }
  });

  it('requests a same-origin canonical target exactly once and records what it found', async () => {
    const {artifact, calls} = await run(
      {canonicals: ['https://example.com/shoes-main'], bodyTextLength: 10},
      {
        body: '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="/third"></head></html>',
        headers: {'x-robots-tag': ['googlebot: noindex']},
      }
    );
    expect(calls).toEqual(['https://example.com/shoes-main']);
    expect(artifact.target).toMatchObject({
      url: 'https://example.com/shoes-main',
      status: 200,
      xRobotsTag: ['googlebot: noindex'],
      metas: [{name: 'robots', content: 'noindex'}],
      canonicals: ['/third'],
    });
  });

  it('records a redirecting target without following it', async () => {
    const {artifact, calls} = await run(
      {canonicals: ['https://example.com/old'], bodyTextLength: 1},
      {status: 301, location: 'https://example.com/new'}
    );
    expect(calls).toEqual(['https://example.com/old']);
    expect(artifact.target).toMatchObject({
      status: 301,
      redirectLocation: 'https://example.com/new',
    });
  });

  it('never requests a canonical on another origin, host, port or scheme', async () => {
    for (const href of [
      'https://cdn.example.com/x',
      'https://evil.test/x',
      'https://example.com:8443/x',
      'http://example.com/x',
      'http://169.254.169.254/latest/meta-data/',
      '//evil.test/x',
    ]) {
      const {artifact, calls} = await run({canonicals: [href], bodyTextLength: 1}, null);
      expect(calls).toEqual([]);
      expect(artifact.target).toBeNull();
      expect(artifact.targetSkipped).toMatch(/another origin/);
    }
  });

  it('does not request anything for non-http schemes or several different canonicals', async () => {
    const odd = await run({canonicals: ['javascript:alert(1)'], bodyTextLength: 1}, null);
    expect(odd.calls).toEqual([]);
    const several = await run({canonicals: ['/a', '/b'], bodyTextLength: 1}, null);
    expect(several.calls).toEqual([]);
    expect(several.artifact.targetSkipped).toMatch(/several different canonicals/);
  });

  it('records a target that fails to load as data, with the page canonicals intact', async () => {
    const {artifact} = await run(
      {canonicals: ['https://example.com/shoes-main'], bodyTextLength: 1},
      new Error('connection reset')
    );
    expect(artifact.target).toMatchObject({status: null});
    expect(artifact.target && artifact.target.error).toMatch(/connection reset/);
    expect(artifact.canonicals).toEqual(['https://example.com/shoes-main']);
  });

  it('caps how many canonicals it keeps', async () => {
    const many = Array.from({length: 50}, (_, i) => `/c${i}`);
    const {artifact} = await run({canonicals: many, bodyTextLength: 1}, null);
    expect(artifact.canonicals).toHaveLength(10);
  });
});
