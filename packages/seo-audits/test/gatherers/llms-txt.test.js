/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  default: LlmsTxt,
  collectLlmsTxt,
  skippedWarning,
} = require('../../src/gatherers/llms-txt.js');

const PAGE = {finalDisplayedUrl: 'https://example.com/deep/page?x=1#top'};

/** @param {{status?: number, body?: string, location?: string} | Error} route */
const collect = route => {
  const calls = [];
  const fetchBytes = async (url, options) => {
    calls.push([url, options]);
    if (route instanceof Error) throw route;
    return {
      status: route.status ?? 200,
      redirectLocation: route.location ?? null,
      body: Buffer.from(route.body ?? ''),
    };
  };
  return collectLlmsTxt(PAGE, {fetchBytes}).then(artifact => ({artifact, calls}));
};

describe('collectLlmsTxt', () => {
  it('fetches /llms.txt at the origin root only, with the documented bounds', async () => {
    const {calls} = await collect({body: '# x'});
    expect(calls).toEqual([
      ['https://example.com/llms.txt', {timeoutMs: 5000, maxBytes: 1024 * 1024}],
    ]);
  });

  it('returns the text of a present file', async () => {
    const {artifact} = await collect({body: '# Site\n'});
    expect(artifact).toEqual({
      url: 'https://example.com/llms.txt',
      state: 'present',
      status: 200,
      reason: null,
      text: '# Site\n',
    });
  });

  it.each([[404], [410], [403]])('treats HTTP %i as absent', async status => {
    const {artifact} = await collect({status});
    expect(artifact).toMatchObject({state: 'absent', status, text: null, reason: null});
    expect(skippedWarning(artifact)).toBeNull();
  });

  it('treats a server error as unavailable, with the reason', async () => {
    const {artifact} = await collect({status: 503});
    expect(artifact).toMatchObject({state: 'unavailable', status: 503});
    expect(artifact.reason).toBe('https://example.com/llms.txt returned HTTP 503');
  });

  it('reports a redirect with its target and does not follow it', async () => {
    const {artifact, calls} = await collect({status: 301, location: 'https://example.com/new.txt'});
    expect(artifact.state).toBe('unavailable');
    expect(artifact.reason).toContain(
      'redirects to https://example.com/new.txt, which is not followed'
    );
    expect(calls).toHaveLength(1);
  });

  it('records a fetch failure (refused, timeout, over the size cap) instead of throwing', async () => {
    const {artifact} = await collect(new Error('response for "x" exceeded 1048576 bytes'));
    expect(artifact.state).toBe('unavailable');
    expect(artifact.reason).toContain('could not be fetched: response for "x" exceeded');
  });

  it('builds a run warning only for an unavailable file', async () => {
    const unavailable = (await collect({status: 500})).artifact;
    expect(skippedWarning(unavailable)).toBe(
      'llms.txt was not checked: https://example.com/llms.txt returned HTTP 500'
    );
    expect(skippedWarning((await collect({body: '# x'})).artifact)).toBeNull();
    expect(skippedWarning((await collect({status: 404})).artifact)).toBeNull();
  });
});

describe('LlmsTxt gatherer class', () => {
  const original = process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
  afterEach(() => {
    if (original === undefined) delete process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
    else process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK = original;
  });

  it('adds a run warning naming the cause and the setting when a private host is refused', async () => {
    delete process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
    const passContext = {
      baseArtifacts: {URL: {finalDisplayedUrl: 'http://127.0.0.1:9/'}, LighthouseRunWarnings: []},
    };
    // Real default fetcher: the SSRF policy refuses the loopback address before any connection.
    const artifact = await new LlmsTxt().getArtifact(passContext);
    expect(artifact.state).toBe('unavailable');
    expect(passContext.baseArtifacts.LighthouseRunWarnings).toHaveLength(1);
    expect(passContext.baseArtifacts.LighthouseRunWarnings[0]).toMatch(
      /llms\.txt was not checked: .*private\/reserved.*LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/
    );
  });
});
