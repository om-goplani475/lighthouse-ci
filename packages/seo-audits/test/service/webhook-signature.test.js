/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const crypto = require('crypto');
const {
  verifyWebhook,
  createReplayGuard,
  hmacHex,
} = require('../../src/service/webhook-signature.js');

const SECRET = 's3cret';
const BODY = '{"hello":"world"}';
const NOW = 1_800_000_000_000;

describe('verifyWebhook', () => {
  describe('github', () => {
    const signed = (body = BODY, secret = SECRET) => ({
      'X-Hub-Signature-256': `sha256=${hmacHex(secret, body)}`,
      'X-GitHub-Delivery': 'abc-123',
    });

    it('accepts a correct signature and returns the delivery id as the replay key', () => {
      expect(
        verifyWebhook({provider: 'github', headers: signed(), rawBody: BODY, secret: SECRET})
      ).toEqual({ok: true, replayKey: 'abc-123'});
    });

    it('matches header names case-insensitively and takes a Buffer body', () => {
      const headers = {'x-hub-signature-256': signed()['X-Hub-Signature-256']};
      expect(
        verifyWebhook({provider: 'github', headers, rawBody: Buffer.from(BODY), secret: SECRET}).ok
      ).toBe(true);
    });

    it('rejects a body changed by one byte, a wrong secret, and malformed or missing headers', () => {
      const bad = [
        {headers: signed(), rawBody: BODY + ' ', secret: SECRET},
        {headers: signed(BODY, 'other'), rawBody: BODY, secret: SECRET},
        {headers: {'X-Hub-Signature-256': 'sha256=zz'}, rawBody: BODY, secret: SECRET},
        {headers: {'X-Hub-Signature-256': `sha1=${'a'.repeat(40)}`}, rawBody: BODY, secret: SECRET},
        {headers: {}, rawBody: BODY, secret: SECRET},
      ];
      for (const input of bad) {
        expect(verifyWebhook({provider: 'github', ...input}).ok).toBe(false);
      }
    });
  });

  describe('gitlab', () => {
    it('accepts the right token and rejects a wrong, missing or different-length one', () => {
      const run = headers =>
        verifyWebhook({provider: 'gitlab', headers, rawBody: BODY, secret: SECRET});
      expect(run({'X-Gitlab-Token': SECRET})).toEqual({ok: true, replayKey: null});
      expect(run({'X-Gitlab-Token': 's3cre'}).ok).toBe(false);
      expect(run({'X-Gitlab-Token': SECRET + 'x'}).ok).toBe(false);
      expect(run({}).ok).toBe(false);
    });
  });

  describe('lhci', () => {
    const stamp = String(NOW / 1000);
    const headersFor = (ts, body = BODY) => ({
      'X-Lhci-Timestamp': ts,
      'X-Lhci-Signature': `sha256=${hmacHex(SECRET, `${ts}.${body}`)}`,
    });
    const run = (headers, now = NOW, body = BODY) =>
      verifyWebhook({provider: 'lhci', headers, rawBody: body, secret: SECRET, now});

    it('accepts a fresh signed request', () => {
      const result = run(headersFor(stamp));
      expect(result.ok).toBe(true);
      expect(result.replayKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects a stale or future timestamp even when correctly signed', () => {
      expect(run(headersFor(String(NOW / 1000 - 301))).reason).toMatch(/window/);
      expect(run(headersFor(String(NOW / 1000 + 301))).reason).toMatch(/window/);
      expect(run(headersFor(String(NOW / 1000 - 299))).ok).toBe(true);
    });

    it('does not reveal staleness for a forged signature', () => {
      const forged = {'X-Lhci-Timestamp': '1', 'X-Lhci-Signature': `sha256=${'0'.repeat(64)}`};
      expect(run(forged).reason).toBe('bad signature');
    });

    it('binds the timestamp to the body, so a captured signature cannot be reused with another timestamp', () => {
      const h = headersFor(stamp);
      expect(run({...h, 'X-Lhci-Timestamp': String(NOW / 1000 + 1)}).ok).toBe(false);
      expect(run(h, NOW, BODY + 'x').ok).toBe(false);
    });

    it('rejects a malformed timestamp', () => {
      expect(run({...headersFor(stamp), 'X-Lhci-Timestamp': '1e9'}).ok).toBe(false);
      expect(run({...headersFor(stamp), 'X-Lhci-Timestamp': '-5'}).ok).toBe(false);
    });
  });

  it('fails closed on no secret, no body, an unknown provider', () => {
    const headers = {'X-Gitlab-Token': ''};
    expect(verifyWebhook({provider: 'gitlab', headers, rawBody: BODY, secret: ''}).ok).toBe(false);
    expect(verifyWebhook({provider: 'gitlab', headers, rawBody: undefined, secret: 'x'}).ok).toBe(
      false
    );
    expect(verifyWebhook({provider: 'bitbucket', headers, rawBody: BODY, secret: 'x'}).ok).toBe(
      false
    );
    // Compare with a real HMAC from crypto, so the helper is not testing itself.
    expect(hmacHex('k', 'd')).toBe(crypto.createHmac('sha256', 'k').update('d').digest('hex'));
  });
});

describe('createReplayGuard', () => {
  it('flags a repeat inside the window and allows it after expiry', () => {
    const guard = createReplayGuard({ttlMs: 1000});
    expect(guard.seen('a', 0)).toBe(false);
    expect(guard.seen('a', 500)).toBe(true);
    expect(guard.seen('a', 1500)).toBe(false);
  });

  it('stays bounded under a flood of unique ids, evicting expired then oldest', () => {
    const guard = createReplayGuard({ttlMs: 1000, maxEntries: 3});
    for (let i = 0; i < 100; i++) guard.seen(`k${i}`, i);
    expect(guard.size()).toBeLessThanOrEqual(3);
    // The newest ids are still remembered, so a very recent replay is still caught.
    expect(guard.seen('k99', 100)).toBe(true);
    expect(guard.seen('k0', 100)).toBe(false);
  });
});
