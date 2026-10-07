/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Encryption of the SEO service's stored secrets (webhook secrets, notification tokens) at rest. AES-256-GCM, a fresh
 * random 96-bit nonce per value. The key comes from the environment only (`LHCI_SEO_SECRET_KEY`), never from the database
 * that holds the ciphertext, so a copy of the database alone does not give up the secrets.
 *
 * Stored form: `enc:v1:<nonce>.<tag>.<ciphertext>` (base64url). Each value is bound to a context string (which column of
 * which project it belongs to) as GCM additional data, so a ciphertext copied into another row does not open.
 *
 * - No key set: values are stored as they are (as before this module existed). `enabled` is false.
 * - A value without the `enc:v1:` prefix is a plain legacy value and is read as it is.
 * - An encrypted value with no usable key never falls back to plain text: `open` throws.
 * - `LHCI_SEO_SECRET_KEY_PREVIOUS` lets the key be rotated: values it opens are reported as `stale` so they can be
 *   written again under the current key.
 */
'use strict';

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const KEY_BYTES = 32;

/**
 * @param {string} text 64 hex characters, or base64 / base64url of 32 bytes.
 * @return {Buffer}
 * @throws {Error} When the text is not a 32-byte key. The message never contains the text.
 */
function parseKey(text) {
  const value = String(text).trim();
  /** @type {Buffer | null} */
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, 'hex');
  else if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(value)) key = Buffer.from(value, 'base64');
  if (!key || key.length !== KEY_BYTES) {
    throw new Error('the secret key must be 32 bytes, written as 64 hex characters or as base64');
  }
  return key;
}

/**
 * @param {{key?: string | null, previousKey?: string | null}} [options]
 * @return {{enabled: boolean, seal: (text: string, context: string) => string, open: (stored: string, context: string) => {text: string, stale: boolean}, isSealed: (stored: unknown) => boolean}}
 */
function createSecretBox(options = {}) {
  const key = options.key ? parseKey(options.key) : null;
  const previous = options.previousKey ? parseKey(options.previousKey) : null;
  if (previous && !key) throw new Error('LHCI_SEO_SECRET_KEY_PREVIOUS needs LHCI_SEO_SECRET_KEY');

  /** @param {unknown} stored @return {boolean} */
  const isSealed = stored => typeof stored === 'string' && stored.startsWith(PREFIX);

  return {
    enabled: key !== null,
    isSealed,

    /**
     * @param {string} text
     * @param {string} context
     * @return {string} The sealed form, or `text` unchanged when no key is set.
     */
    seal(text, context) {
      if (!key) return text;
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return `${PREFIX}${[nonce, cipher.getAuthTag(), data]
        .map(b => b.toString('base64url'))
        .join('.')}`;
    },

    /**
     * @param {string} stored
     * @param {string} context
     * @return {{text: string, stale: boolean}} `stale` is true when the value should be written again: it is plain
     *   while a key is set, or it was sealed with the previous key.
     * @throws {Error} When the value is sealed and cannot be opened (no key, wrong key, other context, damaged).
     */
    open(stored, context) {
      if (!isSealed(stored)) return {text: stored, stale: key !== null};
      const parts = stored.slice(PREFIX.length).split('.');
      if (parts.length !== 3) throw new Error('a stored secret is damaged');
      const [nonce, tag, data] = parts.map(p => Buffer.from(p, 'base64url'));
      for (const [candidate, stale] of /** @type {Array<[Buffer | null, boolean]>} */ ([
        [key, false],
        [previous, true],
      ])) {
        if (!candidate) continue;
        try {
          const decipher = crypto.createDecipheriv('aes-256-gcm', candidate, nonce);
          decipher.setAAD(Buffer.from(context));
          decipher.setAuthTag(tag);
          const text = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
          return {text, stale};
        } catch (_) {
          // wrong key for this value: try the previous one
        }
      }
      throw new Error(
        key
          ? 'a stored secret cannot be opened with LHCI_SEO_SECRET_KEY (wrong key, or the value was moved)'
          : 'a stored secret is encrypted but LHCI_SEO_SECRET_KEY is not set'
      );
    },
  };
}

module.exports = {createSecretBox, parseKey, PREFIX};
