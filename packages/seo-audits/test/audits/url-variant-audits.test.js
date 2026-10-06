/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const Consistency = require('../../src/audits/url-variant-consistency.js').default;
const ChainLength = require('../../src/audits/redirect-chain-length.js').default;
const Loop = require('../../src/audits/redirect-loop.js').default;

const AUDITED = 'https://example.com/';
const hop = (/** @type {string} */ url, /** @type {number} */ status, location = null) => ({
  url,
  status,
  location,
});
const variant = (/** @type {any} */ over) => ({
  kind: 'http-same-host',
  startUrl: 'http://example.com/',
  hops: [],
  end: 'final',
  endUrl: null,
  reason: null,
  ...over,
});
const artifact = (/** @type {any[]} */ variants) => ({
  UrlVariants: {audited: AUDITED, canonicalOrigin: 'https://example.com', variants, skipped: null},
});

describe('the URL-variant audits', () => {
  it('declare distinct ids (no hyphen followed by a digit) and read the one artifact', () => {
    const ids = [Consistency, ChainLength, Loop].map(a => a.meta.id);
    expect(ids).toEqual(['url-variant-consistency', 'redirect-chain-length', 'redirect-loop']);
    for (const id of ids) expect(id).not.toMatch(/-\d/);
    for (const a of [Consistency, ChainLength, Loop]) {
      expect(a.meta.requiredArtifacts).toEqual(['UrlVariants']);
    }
  });

  const clean = variant({
    hops: [hop('http://example.com/', 301, AUDITED), hop(AUDITED, 200)],
    endUrl: AUDITED,
  });
  const looping = variant({
    end: 'loop',
    hops: [
      hop('http://example.com/', 301, 'http://example.com/b'),
      hop('http://example.com/b', 301, 'http://example.com/'),
    ],
    endUrl: 'http://example.com/',
  });
  const long = variant({
    hops: [
      hop('http://example.com/', 301, 'http://www.example.com/'),
      hop('http://www.example.com/', 301, 'https://www.example.com/'),
      hop('https://www.example.com/', 301, 'https://example.com/x'),
      hop('https://example.com/x', 301, AUDITED),
      hop(AUDITED, 200),
    ],
    endUrl: AUDITED,
  });
  const direct = variant({hops: [hop('http://example.com/', 200)], endUrl: 'http://example.com/'});

  it('pass a correct site (static fixture)', () => {
    for (const a of [Consistency, ChainLength, Loop]) {
      expect(a.audit(artifact([clean])).score).toBe(1);
    }
  });

  it('each fail only the problem it owns (static fixtures)', () => {
    expect(Consistency.audit(artifact([direct])).score).toBe(0);
    expect(ChainLength.audit(artifact([direct])).score).toBe(1);
    expect(Loop.audit(artifact([direct])).score).toBe(1);

    expect(ChainLength.audit(artifact([long])).score).toBe(0.5);
    expect(Consistency.audit(artifact([long])).score).toBe(1);
    expect(Loop.audit(artifact([long])).score).toBe(1);

    expect(Loop.audit(artifact([looping])).score).toBe(0);
    expect(ChainLength.audit(artifact([looping])).score).toBe(1);
    expect(Consistency.audit(artifact([looping])).score).toBe(1);
  });

  it('do not throw when the artifact is missing or skipped', () => {
    for (const a of [Consistency, ChainLength, Loop]) {
      expect(a.audit({UrlVariants: /** @type {any} */ (null)})).toMatchObject({
        notApplicable: true,
      });
      expect(
        a.audit({
          UrlVariants: {
            audited: AUDITED,
            canonicalOrigin: null,
            variants: [],
            skipped: 'the page uses a non-default port (1)',
          },
        })
      ).toMatchObject({notApplicable: true});
    }
  });
});
