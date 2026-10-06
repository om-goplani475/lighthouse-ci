/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verifies that a webhook really comes from the project that owns the secret. Pure apart from `crypto`: the caller
 * passes the RAW request body (the exact bytes received), the headers and the clock.
 *
 * - github: `X-Hub-Signature-256: sha256=<hex HMAC of the body>`; the delivery id (`X-GitHub-Delivery`) is the replay key.
 * - gitlab: `X-Gitlab-Token` carries the secret itself; compared in constant time. GitLab sends no delivery id, so a
 *   replay cannot be detected for it (the token proves the sender, not the freshness).
 * - lhci: our own generic form for CI jobs: `X-Lhci-Timestamp` (seconds) and `X-Lhci-Signature: sha256=<hex HMAC of
 *   "<timestamp>.<body>">`, accepted within a time window, with the signature itself as the replay key.
 */

import crypto from 'crypto';

/** @typedef {'github' | 'gitlab' | 'lhci'} Provider */
/** @typedef {{ok: true, replayKey: string | null} | {ok: false, reason: string}} Verdict */

const TIMESTAMP_WINDOW_SECONDS = 300;

/**
 * @param {string} a
 * @param {string} b
 * @return {boolean} Whether the strings are equal, in time that does not depend on where they differ or on their lengths.
 */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * @param {string} secret
 * @param {string | Buffer} data
 * @return {string}
 */
function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 * @return {string | undefined} The header value (the first when repeated); names are matched case-insensitively.
 */
function header(headers, name) {
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() !== name) continue;
    const value = headers[key];
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * @param {string | undefined} value
 * @return {string | null} The hex digest of a `sha256=<hex>` header, or null when malformed.
 */
function parseSha256(value) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(value || '');
  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {{
 *   provider: string,
 *   headers: Record<string, string | string[] | undefined>,
 *   rawBody: string | Buffer,
 *   secret: string,
 *   now?: number,
 * }} input `now` is milliseconds since the epoch.
 * @return {Verdict}
 */
function verifyWebhook({provider, headers, rawBody, secret, now = Date.now()}) {
  if (!secret || typeof secret !== 'string') return {ok: false, reason: 'no secret configured'};
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) {
    return {ok: false, reason: 'raw body missing'};
  }

  if (provider === 'github') {
    const sent = parseSha256(header(headers, 'x-hub-signature-256'));
    if (!sent) return {ok: false, reason: 'missing or malformed signature'};
    if (!safeEqual(sent, hmacHex(secret, rawBody))) return {ok: false, reason: 'bad signature'};
    return {ok: true, replayKey: header(headers, 'x-github-delivery') || null};
  }

  if (provider === 'gitlab') {
    const token = header(headers, 'x-gitlab-token');
    if (!token) return {ok: false, reason: 'missing token'};
    if (!safeEqual(token, secret)) return {ok: false, reason: 'bad token'};
    return {ok: true, replayKey: null};
  }

  if (provider === 'lhci') {
    const sent = parseSha256(header(headers, 'x-lhci-signature'));
    const stamp = header(headers, 'x-lhci-timestamp');
    if (!sent || !stamp || !/^\d{1,12}$/.test(stamp)) {
      return {ok: false, reason: 'missing or malformed signature or timestamp'};
    }
    // Check the signature before the window so the reason does not tell a forger how stale their guess was.
    const expected = hmacHex(secret, `${stamp}.${rawBody.toString()}`);
    if (!safeEqual(sent, expected)) return {ok: false, reason: 'bad signature'};
    if (Math.abs(now / 1000 - Number(stamp)) > TIMESTAMP_WINDOW_SECONDS) {
      return {ok: false, reason: 'timestamp outside the allowed window'};
    }
    return {ok: true, replayKey: sent};
  }

  return {ok: false, reason: `unknown provider "${provider}"`};
}

/**
 * A bounded memory of recent delivery ids. A repeat inside the window is a replay. When full, expired entries go
 * first, then the oldest, so a flood of unique ids can neither grow memory without limit nor lock real deliveries out.
 *
 * @param {{ttlMs?: number, maxEntries?: number}} [options]
 * @return {{seen: (key: string, now?: number) => boolean, size: () => number}}
 */
function createReplayGuard({ttlMs = 10 * 60 * 1000, maxEntries = 10000} = {}) {
  /** @type {Map<string, number>} */
  const entries = new Map();
  return {
    /**
     * @param {string} key
     * @param {number} [now]
     * @return {boolean} True when the key was already seen inside the window; otherwise records it and returns false.
     */
    seen(key, now = Date.now()) {
      const at = entries.get(key);
      if (at !== undefined && now - at <= ttlMs) return true;
      entries.delete(key);
      if (entries.size >= maxEntries) {
        for (const [k, t] of entries) if (now - t > ttlMs) entries.delete(k);
        while (entries.size >= maxEntries) {
          const oldest = entries.keys().next();
          if (oldest.done) break;
          entries.delete(oldest.value);
        }
      }
      entries.set(key, now);
      return false;
    },
    size: () => entries.size,
  };
}

export {verifyWebhook, createReplayGuard, safeEqual, hmacHex, TIMESTAMP_WINDOW_SECONDS};
