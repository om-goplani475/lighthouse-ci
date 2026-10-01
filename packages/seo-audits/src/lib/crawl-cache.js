/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * A small on-disk cache for crawl snapshots, so the several Lighthouse runs of one `lhci collect` (each is
 * its own child process) crawl the site once. The cache holds data later audits trust, in a directory on a
 * machine other people may share, so it is conservative:
 *
 * - The directory (default `<tmpdir>/lhci-seo-crawl-<uid>`) is used only if it is a real directory (not a
 *   symlink), owned by the current user, with no group or other access (mode `0700`). Anything else means
 *   the cache is simply not used: the crawl still runs, uncached. Another user planting a directory or a
 *   symlink can therefore at worst disable the cache, never feed it forged results.
 * - Files are named by a hex digest only, so a hostile key cannot reach outside the directory; a cache file
 *   must be a regular file (not a symlink) owned by the user, of bounded size.
 * - Writes are atomic (a temp file, then a rename), so a concurrent run never reads half a file.
 * - A file that is missing, corrupt, the wrong shape or version, expired, or dated in the future reads as
 *   "no cache". Nothing here ever throws.
 *
 * Contents are only the extracted snapshot (no raw HTML, no cookies, no headers beyond the robots signals).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {isSnapshot} from './crawl-snapshot.js';

/** @typedef {import('./crawl-snapshot.js').CrawlSnapshot} CrawlSnapshot */

const CACHE_DIR_ENV = 'LHCI_SEO_CRAWL_CACHE_DIR';
const CACHE_TTL_ENV = 'LHCI_SEO_CRAWL_CACHE_TTL_SECONDS';
const DEFAULT_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 86_400;
const MAX_CACHE_FILE_BYTES = 16 * 1024 * 1024;
const FUTURE_SKEW_MS = 60_000;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * @return {number | null} The current user id, or null where the platform has none (Windows).
 */
function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @return {{dir: string | null, ttlMs: number}} `dir` is null when the cache is disabled (TTL 0).
 */
function resolveCacheSettings(env) {
  const raw = Number.parseInt(env[CACHE_TTL_ENV] || '', 10);
  const ttlSeconds = Number.isFinite(raw)
    ? Math.min(MAX_TTL_SECONDS, Math.max(0, raw))
    : DEFAULT_TTL_SECONDS;
  if (ttlSeconds === 0) return {dir: null, ttlMs: 0};

  const uid = currentUid();
  const owner =
    uid === null ? os.userInfo().username.replace(/[^A-Za-z0-9_.-]/g, '_') : String(uid);
  const dir = env[CACHE_DIR_ENV] || path.join(os.tmpdir(), `lhci-seo-crawl-${owner}`);
  return {dir, ttlMs: ttlSeconds * 1000};
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @return {string | null}
 */
function resolveCacheDir(env) {
  return resolveCacheSettings(env).dir;
}

/**
 * Whether the directory may be trusted as this user's private cache.
 * @param {string} dir
 * @param {{uid?: number | null}} [options] `uid` is injectable for tests.
 * @return {boolean}
 */
function isSafeCacheDir(dir, {uid = currentUid()} = {}) {
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    if (uid !== null && stat.uid !== uid) return false;
    // Windows reports permissive modes regardless; only enforce where the user id check applies.
    if (uid !== null && (stat.mode & 0o077) !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates the directory (mode 0700) if it is missing, then checks it is safe. Only one level is created:
 * the parent must already exist. (Node's recursive `mkdir` can loop forever on a path that cannot be
 * created, such as one under `/proc`, which would freeze the Lighthouse run; found by the tests. A cache
 * directory whose parent is missing simply means no cache.)
 * @param {string} dir
 * @param {{uid?: number | null}} [options]
 * @return {boolean} Whether the directory can be used.
 */
function ensureCacheDir(dir, options) {
  if (!dir) return false;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {mode: 0o700});
  } catch {
    return false;
  }
  return isSafeCacheDir(dir, options);
}

/**
 * @param {string} dir
 * @param {string} key
 * @return {string | null}
 */
function filePath(dir, key) {
  return KEY_PATTERN.test(key) ? path.join(dir, `${key}.json`) : null;
}

/**
 * @param {string} dir
 * @param {string} key
 * @param {{ttlMs: number, now?: () => number, uid?: number | null}} options
 * @return {CrawlSnapshot | null} The cached snapshot, or null for anything but a fresh, valid, trusted one.
 */
function readSnapshot(dir, key, {ttlMs, now = Date.now, uid = currentUid()}) {
  try {
    const file = filePath(dir, key);
    if (!file || ttlMs <= 0 || !isSafeCacheDir(dir, {uid})) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    if (uid !== null && stat.uid !== uid) return null;
    if (stat.size > MAX_CACHE_FILE_BYTES) return null;

    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isSnapshot(value)) return null;
    const age = now() - Date.parse(value.createdAt);
    if (age > ttlMs || age < -FUTURE_SKEW_MS) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * @param {string} dir
 * @param {string} key
 * @param {CrawlSnapshot} snapshot
 * @param {{uid?: number | null}} [options]
 * @return {boolean} Whether the snapshot was written (false: unsafe directory, too large, or any error).
 */
function writeSnapshot(dir, key, snapshot, options) {
  let temp = null;
  try {
    const file = filePath(dir, key);
    if (!file || !ensureCacheDir(dir, options)) return false;
    const data = JSON.stringify(snapshot);
    if (Buffer.byteLength(data) > MAX_CACHE_FILE_BYTES) return false;

    temp = path.join(dir, `${key}.${process.pid}.${Date.now().toString(36)}.tmp`);
    fs.writeFileSync(temp, data, {mode: 0o600, flag: 'wx'});
    fs.renameSync(temp, file);
    temp = null;
    return true;
  } catch {
    if (temp) {
      try {
        fs.unlinkSync(temp);
      } catch {
        // Nothing more to do.
      }
    }
    return false;
  }
}

export {
  resolveCacheSettings,
  resolveCacheDir,
  isSafeCacheDir,
  ensureCacheDir,
  readSnapshot,
  writeSnapshot,
  CACHE_DIR_ENV,
  CACHE_TTL_ENV,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MAX_CACHE_FILE_BYTES,
};
