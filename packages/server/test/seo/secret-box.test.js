/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/* eslint-env jest */

const {createSecretBox, parseKey, PREFIX} = require('../../src/seo/secret-box.js');

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('parseKey', () => {
  it('accepts 64 hex characters and 32 bytes of base64', () => {
    expect(parseKey(KEY_A)).toHaveLength(32);
    expect(parseKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32);
    expect(parseKey(Buffer.alloc(32, 7).toString('base64url'))).toHaveLength(32);
  });

  it.each(['', 'short', 'g'.repeat(64), 'a'.repeat(63), Buffer.alloc(16).toString('base64')])(
    'rejects %j without echoing it',
    bad => {
      expect(() => parseKey(bad)).toThrow(/32 bytes/);
      if (bad.length > 3) {
        try {
          parseKey(bad);
        } catch (err) {
          expect(err.message).not.toContain(bad);
        }
      }
    }
  );
});

describe('createSecretBox', () => {
  it('stores plain text and reports itself off when no key is set', () => {
    const box = createSecretBox();
    expect(box.enabled).toBe(false);
    expect(box.seal('hello', 'ctx')).toBe('hello');
    expect(box.open('hello', 'ctx')).toEqual({text: 'hello', stale: false});
  });

  it('round-trips, and never stores the text readable', () => {
    const box = createSecretBox({key: KEY_A});
    const sealed = box.seal('xoxb-very-secret ünïcode ✓', 'ctx');
    expect(sealed.startsWith(PREFIX)).toBe(true);
    expect(sealed).not.toContain('very-secret');
    expect(box.open(sealed, 'ctx')).toEqual({text: 'xoxb-very-secret ünïcode ✓', stale: false});
  });

  it('uses a new nonce each time', () => {
    const box = createSecretBox({key: KEY_A});
    expect(box.seal('same', 'ctx')).not.toBe(box.seal('same', 'ctx'));
  });

  it('refuses a value moved to another context', () => {
    const box = createSecretBox({key: KEY_A});
    expect(() => box.open(box.seal('x', 'project-1'), 'project-2')).toThrow(/cannot be opened/);
  });

  it('refuses a wrong key, a damaged value and a missing key; never returns plain text', () => {
    const sealed = createSecretBox({key: KEY_A}).seal('x', 'ctx');
    expect(() => createSecretBox({key: KEY_B}).open(sealed, 'ctx')).toThrow(/cannot be opened/);
    expect(() => createSecretBox().open(sealed, 'ctx')).toThrow(/LHCI_SEO_SECRET_KEY is not set/);
    const box = createSecretBox({key: KEY_A});
    const [nonce, tag, data] = sealed.slice(PREFIX.length).split('.');
    const flipped = `${PREFIX}${nonce}.${tag}.${data.replace(/^./, c => (c === 'A' ? 'B' : 'A'))}`;
    expect(() => box.open(flipped, 'ctx')).toThrow();
    expect(() => box.open(`${PREFIX}nonsense`, 'ctx')).toThrow(/damaged/);
  });

  it('marks plain values as stale when a key is set', () => {
    expect(createSecretBox({key: KEY_A}).open('legacy', 'ctx')).toEqual({
      text: 'legacy',
      stale: true,
    });
  });

  it('opens values sealed with the previous key and marks them stale', () => {
    const old = createSecretBox({key: KEY_A}).seal('x', 'ctx');
    const rotated = createSecretBox({key: KEY_B, previousKey: KEY_A});
    expect(rotated.open(old, 'ctx')).toEqual({text: 'x', stale: true});
    expect(rotated.open(rotated.seal('y', 'ctx'), 'ctx').stale).toBe(false);
  });

  it('needs a current key for a previous key, and rejects a bad key at start-up', () => {
    expect(() => createSecretBox({previousKey: KEY_A})).toThrow(/needs LHCI_SEO_SECRET_KEY/);
    expect(() => createSecretBox({key: 'nope'})).toThrow(/32 bytes/);
  });
});
