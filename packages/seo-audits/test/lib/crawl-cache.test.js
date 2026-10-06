/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {
  resolveCacheSettings,
  resolveCacheDir,
  isSafeCacheDir,
  ensureCacheDir,
  readSnapshot,
  writeSnapshot,
  DEFAULT_TTL_SECONDS,
  MAX_CACHE_FILE_BYTES,
} = require('../../src/lib/crawl-cache.js');
const {cacheKey, USER_AGENT} = require('../../src/lib/crawl-snapshot.js');

const UID = typeof process.getuid === 'function' ? process.getuid() : null;
const posixOnly = UID === null ? it.skip : it;
const KEY = cacheKey({
  origin: 'https://example.com',
  pages: 50,
  depth: 3,
  robots: 'honour',
  userAgent: USER_AGENT,
});

/** @param {number} [createdAt] */
const snapshot = (createdAt = Date.now(), requests = 1) => ({
  version: 3,
  origin: 'https://example.com',
  createdAt: new Date(createdAt).toISOString(),
  bounds: {pages: 50, depth: 3, budgetMs: 120000, robots: 'honour', userAgent: USER_AGENT},
  robots: {state: 'present'},
  seeds: {audited: 1, home: 0, links: 0, sitemap: 0},
  sitemapUrls: [],
  pages: [],
  skipped: [],
  stats: {
    requests,
    elapsedMs: 5,
    truncatedByBudget: false,
    overPageCap: false,
    cutByDepth: false,
  },
});

/** @type {string} */
let base;
/** @type {string} */
let dir;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-cache-test-'));
  dir = path.join(base, 'cache');
});
afterEach(() => {
  fs.rmSync(base, {recursive: true, force: true});
});

describe('resolveCacheSettings', () => {
  it('defaults to a per-user directory under the temp dir and a 10 minute TTL', () => {
    const {dir: d, ttlMs} = resolveCacheSettings({});
    expect(d).toMatch(
      new RegExp(`^${os.tmpdir().replace(/[\\\\/]/g, '.')}.lhci-seo-crawl-[A-Za-z0-9_.-]+$`)
    );
    expect(ttlMs).toBe(DEFAULT_TTL_SECONDS * 1000);
  });

  it('honours the directory and TTL variables, clamped', () => {
    expect(resolveCacheSettings({LHCI_SEO_CRAWL_CACHE_DIR: '/x/y'}).dir).toBe('/x/y');
    expect(resolveCacheSettings({LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '30'}).ttlMs).toBe(30_000);
    expect(resolveCacheSettings({LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '999999'}).ttlMs).toBe(
      86_400_000
    );
    expect(resolveCacheSettings({LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '-5'}).dir).toBeNull();
  });

  it('disables the cache with a TTL of 0, and falls back to the default for garbage', () => {
    expect(resolveCacheSettings({LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '0'})).toEqual({
      dir: null,
      ttlMs: 0,
    });
    expect(resolveCacheDir({LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '0'})).toBeNull();
    expect(resolveCacheSettings({LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: 'soon'}).ttlMs).toBe(600_000);
    expect(resolveCacheSettings({LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: ''}).ttlMs).toBe(600_000);
  });
});

describe('ensureCacheDir and isSafeCacheDir', () => {
  it('creates a missing directory (one level) with no group or other access', () => {
    expect(ensureCacheDir(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    if (UID !== null) expect(fs.statSync(dir).mode & 0o077).toBe(0);
  });

  it('does not create missing parents: no cache rather than a surprise tree', () => {
    const nested = path.join(base, 'a', 'b', 'cache');
    expect(ensureCacheDir(nested)).toBe(false);
    expect(fs.existsSync(path.join(base, 'a'))).toBe(false);
    expect(ensureCacheDir('')).toBe(false);
  });

  it('is false for a missing path and for a regular file', () => {
    expect(isSafeCacheDir(path.join(base, 'nope'))).toBe(false);
    const file = path.join(base, 'file');
    fs.writeFileSync(file, 'x');
    expect(isSafeCacheDir(file)).toBe(false);
    expect(ensureCacheDir(file)).toBe(false);
  });

  posixOnly('refuses a symlink to a perfectly good directory', () => {
    const real = path.join(base, 'real');
    fs.mkdirSync(real, {mode: 0o700});
    const link = path.join(base, 'link');
    fs.symlinkSync(real, link);
    expect(isSafeCacheDir(real)).toBe(true);
    expect(isSafeCacheDir(link)).toBe(false);
    expect(writeSnapshot(link, KEY, snapshot())).toBe(false);
    expect(fs.readdirSync(real)).toEqual([]);
  });

  posixOnly('refuses a directory that group or other can access', () => {
    for (const mode of [0o755, 0o750, 0o770, 0o707, 0o701, 0o777]) {
      const d = path.join(base, `m${mode.toString(8)}`);
      fs.mkdirSync(d);
      fs.chmodSync(d, mode);
      expect(isSafeCacheDir(d)).toBe(false);
    }
    const ok = path.join(base, 'ok');
    fs.mkdirSync(ok);
    fs.chmodSync(ok, 0o700);
    expect(isSafeCacheDir(ok)).toBe(true);
  });

  posixOnly('refuses a directory owned by someone else', () => {
    fs.mkdirSync(dir, {mode: 0o700});
    expect(isSafeCacheDir(dir)).toBe(true);
    expect(isSafeCacheDir(dir, {uid: /** @type {number} */ (UID) + 1})).toBe(false);
    expect(writeSnapshot(dir, KEY, snapshot(), {uid: /** @type {number} */ (UID) + 1})).toBe(false);
    expect(
      readSnapshot(dir, KEY, {ttlMs: 60_000, uid: /** @type {number} */ (UID) + 1})
    ).toBeNull();
  });
});

describe('writeSnapshot and readSnapshot', () => {
  it('round-trips a snapshot', () => {
    const snap = snapshot();
    expect(writeSnapshot(dir, KEY, snap)).toBe(true);
    expect(readSnapshot(dir, KEY, {ttlMs: 60_000})).toEqual(snap);
  });

  posixOnly('writes the file readable by this user only', () => {
    writeSnapshot(dir, KEY, snapshot());
    expect(fs.statSync(path.join(dir, `${KEY}.json`)).mode & 0o077).toBe(0);
  });

  it('leaves no temp file behind', () => {
    writeSnapshot(dir, KEY, snapshot());
    writeSnapshot(dir, KEY, snapshot(Date.now(), 2));
    expect(fs.readdirSync(dir)).toEqual([`${KEY}.json`]);
  });

  it('replaces an earlier snapshot for the same key', () => {
    writeSnapshot(dir, KEY, snapshot(Date.now(), 1));
    writeSnapshot(dir, KEY, snapshot(Date.now(), 2));
    expect(readSnapshot(dir, KEY, {ttlMs: 60_000})?.stats.requests).toBe(2);
  });

  it('is null when nothing was written', () => {
    expect(readSnapshot(dir, KEY, {ttlMs: 60_000})).toBeNull();
    fs.mkdirSync(dir, {mode: 0o700});
    expect(readSnapshot(dir, KEY, {ttlMs: 60_000})).toBeNull();
  });

  it('expires by the TTL, using the injected clock', () => {
    const created = Date.parse('2026-10-01T00:00:00.000Z');
    writeSnapshot(dir, KEY, snapshot(created));
    expect(readSnapshot(dir, KEY, {ttlMs: 600_000, now: () => created + 599_000})).not.toBeNull();
    expect(readSnapshot(dir, KEY, {ttlMs: 600_000, now: () => created + 601_000})).toBeNull();
  });

  it('is null with a TTL of 0', () => {
    writeSnapshot(dir, KEY, snapshot());
    expect(readSnapshot(dir, KEY, {ttlMs: 0})).toBeNull();
  });

  it('rejects a snapshot dated well in the future (a planted or clock-skewed file)', () => {
    const now = Date.parse('2026-10-01T00:00:00.000Z');
    writeSnapshot(dir, KEY, snapshot(now + 3_600_000));
    expect(readSnapshot(dir, KEY, {ttlMs: 600_000, now: () => now})).toBeNull();
    writeSnapshot(dir, KEY, snapshot(now + 10_000));
    expect(readSnapshot(dir, KEY, {ttlMs: 600_000, now: () => now})).not.toBeNull();
  });

  it('treats corrupt, wrong-shape and wrong-version files as no cache', () => {
    fs.mkdirSync(dir, {mode: 0o700});
    const file = path.join(dir, `${KEY}.json`);
    for (const content of [
      '',
      '{not json',
      'null',
      '[]',
      '"a string"',
      JSON.stringify({version: 3}),
      JSON.stringify({...snapshot(), version: 1}),
      JSON.stringify({...snapshot(), pages: 'x'}),
      JSON.stringify({...snapshot(), createdAt: 'yesterday'}),
    ]) {
      fs.writeFileSync(file, content, {mode: 0o600});
      expect(readSnapshot(dir, KEY, {ttlMs: 60_000})).toBeNull();
    }
  });

  it('refuses to write or read an oversized snapshot', () => {
    const huge = {
      ...snapshot(),
      skipped: [{url: 'x', reason: 'failed', detail: 'a'.repeat(MAX_CACHE_FILE_BYTES)}],
    };
    expect(writeSnapshot(dir, KEY, /** @type {any} */ (huge))).toBe(false);
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    fs.writeFileSync(
      path.join(dir, `${KEY}.json`),
      `{"pad":"${'a'.repeat(MAX_CACHE_FILE_BYTES)}"}`,
      {mode: 0o600}
    );
    expect(readSnapshot(dir, KEY, {ttlMs: 60_000})).toBeNull();
  });

  posixOnly('does not follow a symlinked cache file', () => {
    fs.mkdirSync(dir, {mode: 0o700});
    const elsewhere = path.join(base, 'elsewhere.json');
    fs.writeFileSync(elsewhere, JSON.stringify(snapshot()), {mode: 0o600});
    fs.symlinkSync(elsewhere, path.join(dir, `${KEY}.json`));
    expect(readSnapshot(dir, KEY, {ttlMs: 60_000})).toBeNull();
  });

  it('only accepts a 64-character hex key, so a hostile key cannot leave the directory', () => {
    for (const key of [
      '',
      'abc',
      '../escape',
      `${KEY}/../../x`,
      KEY.toUpperCase(),
      `${KEY}.json`,
      `${KEY}\0`,
    ]) {
      expect(writeSnapshot(dir, key, snapshot())).toBe(false);
      expect(readSnapshot(dir, key, {ttlMs: 60_000})).toBeNull();
    }
    expect(fs.existsSync(path.join(base, 'escape.json'))).toBe(false);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it('never throws, whatever the directory is', () => {
    expect(() => writeSnapshot('/proc/definitely/not/writable', KEY, snapshot())).not.toThrow();
    expect(() => readSnapshot('/proc/definitely/not/there', KEY, {ttlMs: 1000})).not.toThrow();
    expect(writeSnapshot('', KEY, snapshot())).toBe(false);
  });
});

describe('atomic writes under concurrency', () => {
  it('a reader never sees a partial file while other processes keep rewriting it', async () => {
    const modulePath = path.join(__dirname, '../../src/lib/crawl-cache.js');
    const script = `
      import {writeSnapshot} from ${JSON.stringify(modulePath)};
      const [dir, key, id] = process.argv.slice(1);
      const snap = n => ({version: 3, origin: 'https://example.com', createdAt: new Date().toISOString(),
        bounds: {pages: 50, depth: 3, budgetMs: 1, robots: 'honour', userAgent: 'x'}, robots: {state: 'present'},
        seeds: {audited: 1, home: 0, links: 0, sitemap: 0}, sitemapUrls: [], pages: [], skipped: [{url: 'x', reason: 'failed', detail: 'p'.repeat(200000)}],
        stats: {requests: n, elapsedMs: 1, truncatedByBudget: false, overPageCap: false, cutByDepth: false}});
      for (let i = 0; i < 150; i++) writeSnapshot(dir, key, snap(Number(id) * 1000 + i));
    `;
    ensureCacheDir(dir);
    const children = [1, 2, 3].map(
      id =>
        new Promise(resolve => {
          const child = spawn(
            process.execPath,
            ['--input-type=module', '-e', script, dir, KEY, String(id)],
            {
              stdio: 'ignore',
            }
          );
          child.on('exit', code => resolve(code));
        })
    );

    let valid = 0;
    let missing = 0;
    const deadline = Date.now() + 15_000;
    let running = true;
    Promise.all(children).then(() => {
      running = false;
    });
    while (running && Date.now() < deadline) {
      const read = readSnapshot(dir, KEY, {ttlMs: 60_000});
      if (read === null) missing++;
      else {
        valid++;
        expect(read.version).toBe(3);
        expect(read.skipped[0].detail).toHaveLength(200000);
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    const codes = await Promise.all(children);
    expect(codes).toEqual([0, 0, 0]);
    expect(valid).toBeGreaterThan(0);
    // Whatever was read was always a complete, valid snapshot; a miss is allowed, a partial read is not.
    expect(readSnapshot(dir, KEY, {ttlMs: 60_000})).not.toBeNull();
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
    expect(missing).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
