/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const Soft404 = require('../../src/audits/soft-not-found.js').default;

const probe = (/** @type {any} */ over) => ({
  shape: 'top-level',
  url: 'https://example.com/lhci-seo-probe-x',
  status: 404,
  location: null,
  targetStatus: null,
  outcome: 'not-found',
  reason: null,
  ...over,
});

describe('soft-not-found audit', () => {
  it('declares its id and the artifact it reads', () => {
    expect(Soft404.meta.id).toBe('soft-not-found');
    expect(Soft404.meta.requiredArtifacts).toEqual(['Soft404Probe']);
  });

  it('passes a site that returns 404 for made-up URLs (static fixture)', () => {
    const result = Soft404.audit({
      Soft404Probe: {
        origin: 'https://example.com',
        probes: [probe({}), probe({})],
        unavailableReason: null,
      },
    });
    expect(result.score).toBe(1);
  });

  it('fails a catch-all site (static fixture)', () => {
    const result = Soft404.audit({
      Soft404Probe: {
        origin: 'https://example.com',
        probes: [
          probe({status: 200, outcome: 'soft-404'}),
          probe({status: 200, outcome: 'soft-404'}),
        ],
        unavailableReason: null,
      },
    });
    expect(result.score).toBe(0);
  });

  it('does not throw when the artifact is missing or empty', () => {
    expect(Soft404.audit({Soft404Probe: /** @type {any} */ (null)})).toMatchObject({
      notApplicable: true,
    });
    expect(
      Soft404.audit({Soft404Probe: {origin: 'x', probes: [], unavailableReason: null}})
    ).toMatchObject({notApplicable: true});
  });
});
