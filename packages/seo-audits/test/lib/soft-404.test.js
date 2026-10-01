/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  probeUrls,
  classifyFirstResponse,
  classifyRedirectTarget,
  describeProbe,
  soft404Product,
} = require('../../src/lib/soft-404.js');

const PROBE = 'https://example.com/lhci-seo-probe-abc';

describe('probeUrls', () => {
  it('builds a top-level and a nested .html URL on the origin from the token', () => {
    expect(probeUrls('https://example.com', 'abc')).toEqual([
      {shape: 'top-level', url: 'https://example.com/lhci-seo-probe-abc'},
      {shape: 'nested-file', url: 'https://example.com/lhci-seo-probe-abc/page.html'},
    ]);
  });

  it('keeps a non-default port', () => {
    expect(probeUrls('http://localhost:8080', 't')[0].url).toBe(
      'http://localhost:8080/lhci-seo-probe-t'
    );
  });
});

describe('classifyFirstResponse', () => {
  const outcome = (/** @type {number} */ status, location = null) =>
    classifyFirstResponse(PROBE, status, location).outcome;

  it('treats any 2xx as a soft 404', () => {
    for (const s of [200, 201, 204, 299]) expect(outcome(s)).toBe('soft-404');
  });

  it('treats 404 and 410 as correct, other 4xx as an error status, 5xx as a server error', () => {
    expect(outcome(404)).toBe('not-found');
    expect(outcome(410)).toBe('not-found');
    for (const s of [400, 401, 403, 451]) expect(outcome(s)).toBe('other-4xx');
    for (const s of [500, 502, 503]) expect(outcome(s)).toBe('server-error');
  });

  it('does not judge 1xx or 6xx', () => {
    expect(outcome(100)).toBe('unexpected-status');
    expect(outcome(600)).toBe('unexpected-status');
  });

  it('asks to follow a same-origin redirect once, resolving a relative Location', () => {
    const step = classifyFirstResponse(PROBE, 301, '/');
    expect(step.follow).toBe('https://example.com/');
    expect(step.location).toBe('https://example.com/');
  });

  it('follows an absolute same-origin Location, including a trailing-slash redirect', () => {
    expect(classifyFirstResponse(PROBE, 308, `${PROBE}/`).follow).toBe(`${PROBE}/`);
  });

  it('never follows a redirect that leaves the origin (host, scheme-relative, port, scheme)', () => {
    for (const loc of [
      'https://evil.test/',
      '//evil.test/x',
      'https://example.com:8443/',
      'http://example.com/',
      'https://example.com.evil.test/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const step = classifyFirstResponse(PROBE, 302, loc);
      expect(step.outcome).toBe('redirect-elsewhere');
      expect(step.follow).toBeNull();
    }
  });

  it('does not follow a redirect with a missing, invalid or non-http Location', () => {
    expect(classifyFirstResponse(PROBE, 302, null).outcome).toBe('redirect-unresolvable');
    expect(classifyFirstResponse(PROBE, 302, '').outcome).toBe('redirect-unresolvable');
    expect(classifyFirstResponse(PROBE, 302, 'http://[bad').outcome).toBe('redirect-unresolvable');
    for (const loc of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/']) {
      const step = classifyFirstResponse(PROBE, 302, loc);
      expect(step.outcome).toBe('redirect-unresolvable');
      expect(step.follow).toBeNull();
    }
  });

  it('cuts an enormous Location in what it reports', () => {
    const step = classifyFirstResponse(PROBE, 302, `https://evil.test/${'a'.repeat(200_000)}`);
    expect(step.location && step.location.length).toBeLessThan(1_100);
  });
});

describe('classifyRedirectTarget', () => {
  it('maps the status of the page a redirect led to', () => {
    expect(classifyRedirectTarget(200)).toBe('redirect-to-page');
    expect(classifyRedirectTarget(204)).toBe('redirect-to-page');
    expect(classifyRedirectTarget(301)).toBe('redirect-chain');
    expect(classifyRedirectTarget(404)).toBe('redirect-to-error');
    expect(classifyRedirectTarget(403)).toBe('redirect-to-error');
    expect(classifyRedirectTarget(503)).toBe('server-error');
    expect(classifyRedirectTarget(100)).toBe('unexpected-status');
  });
});

/**
 * @param {Partial<import('../../src/lib/soft-404.js').Probe>} over
 * @return {import('../../src/lib/soft-404.js').Probe}
 */
const probe = over => ({
  shape: 'top-level',
  url: PROBE,
  status: 404,
  location: null,
  targetStatus: null,
  outcome: 'not-found',
  reason: null,
  ...over,
});

describe('soft404Product', () => {
  const artifact = (/** @type {any[]} */ probes, unavailableReason = null) => ({
    origin: 'https://example.com',
    probes,
    unavailableReason,
  });

  it('is not applicable without an artifact or probes', () => {
    expect(soft404Product(null)).toMatchObject({score: 1, notApplicable: true});
    expect(soft404Product(undefined)).toMatchObject({notApplicable: true});
    expect(soft404Product(artifact([]))).toMatchObject({notApplicable: true});
  });

  it('is not applicable, with the reason, when neither probe could be requested', () => {
    const p = soft404Product(
      artifact(
        [probe({outcome: 'failed', reason: 'boom'}), probe({outcome: 'failed', reason: 'boom'})],
        'boom'
      )
    );
    expect(p).toMatchObject({score: 1, notApplicable: true, explanation: 'boom'});
  });

  it('passes when both made-up URLs return 404 or 410', () => {
    const p = soft404Product(artifact([probe({}), probe({shape: 'nested-file', status: 410})]));
    expect(p.score).toBe(1);
    expect(/** @type {any} */ (p.details).items).toHaveLength(2);
  });

  it('fails when either made-up URL is a soft 404, and says which', () => {
    const p = soft404Product(
      artifact([probe({}), probe({shape: 'nested-file', status: 200, outcome: 'soft-404'})])
    );
    expect(p.score).toBe(0);
    expect(p.explanation).toMatch(/1 of 2 made-up URL/);
    const rows = /** @type {any} */ (p.details).items;
    expect(rows[1]).toMatchObject({probe: 'Nested .html path'});
    expect(rows[1].result).toMatch(/Returned HTTP 200.*soft 404/);
  });

  it('fails when unknown URLs redirect to a page that returns 200', () => {
    const p = soft404Product(
      artifact([
        probe({
          status: 301,
          location: 'https://example.com/',
          targetStatus: 200,
          outcome: 'redirect-to-page',
        }),
        probe({shape: 'nested-file'}),
      ])
    );
    expect(p.score).toBe(0);
    expect(/** @type {any} */ (p.details).items[0].result).toMatch(
      /Redirects to https:\/\/example.com\/, which returns HTTP 200/
    );
  });

  it('passes, with notes, for outcomes that are not soft 404s', () => {
    const p = soft404Product(
      artifact([
        probe({
          status: 301,
          location: 'https://example.com/x',
          targetStatus: 404,
          outcome: 'redirect-to-error',
        }),
        probe({shape: 'nested-file', status: 500, outcome: 'server-error'}),
      ])
    );
    expect(p.score).toBe(1);
  });

  it('judges on the probe that worked when the other failed', () => {
    const ok = soft404Product(
      artifact([probe({}), probe({outcome: 'failed', reason: 'timed out'})])
    );
    expect(ok.score).toBe(1);
    const bad = soft404Product(
      artifact([
        probe({status: 200, outcome: 'soft-404'}),
        probe({outcome: 'failed', reason: 'timed out'}),
      ])
    );
    expect(bad.score).toBe(0);
  });

  it('describes every outcome with a sentence', () => {
    const outcomes = [
      'not-found',
      'other-4xx',
      'soft-404',
      'redirect-to-page',
      'redirect-to-error',
      'redirect-chain',
      'redirect-elsewhere',
      'redirect-unresolvable',
      'server-error',
      'unexpected-status',
      'failed',
    ];
    for (const outcome of outcomes) {
      const text = describeProbe(
        probe({
          outcome: /** @type {any} */ (outcome),
          status: 200,
          targetStatus: 200,
          location: 'https://example.com/x',
          reason: 'why',
        })
      );
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/undefined|null/);
    }
  });
});
