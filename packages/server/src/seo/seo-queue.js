/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The limits that keep the service from being flooded: a bounded job queue with a fixed number of workers (Chrome is
 * heavy), and a per-project rate limit. In memory, on purpose: a run lost to a restart is closed by `failOrphans`.
 */
'use strict';

/**
 * @template T
 * @param {{maxQueued?: number, concurrency?: number, execute: (job: T) => Promise<void>}} options
 * @return {{push: (job: T) => boolean, size: () => number, idle: () => Promise<void>}}
 */
function createQueue({maxQueued = 20, concurrency = 1, execute}) {
  /** @type {T[]} */
  const pending = [];
  let running = 0;
  /** @type {Array<() => void>} */
  let waiters = [];

  const settle = () => {
    if (running === 0 && pending.length === 0) {
      const done = waiters;
      waiters = [];
      done.forEach(resolve => resolve());
    }
  };

  const pump = () => {
    while (running < concurrency && pending.length) {
      const job = /** @type {T} */ (pending.shift());
      running++;
      // `execute` must record its own failures; whatever escapes is swallowed so one bad job cannot stop the queue.
      Promise.resolve()
        .then(() => execute(job))
        .catch(() => {})
        .then(() => {
          running--;
          pump();
          settle();
        });
    }
  };

  return {
    /** @param {T} job @return {boolean} False when the queue is full. */
    push(job) {
      if (pending.length >= maxQueued) return false;
      pending.push(job);
      pump();
      return true;
    },
    size: () => pending.length + running,
    idle: () =>
      running === 0 && pending.length === 0 ? Promise.resolve() : new Promise(r => waiters.push(r)),
  };
}

/**
 * A sliding-window limit per key. Bounded: expired keys are dropped whenever the map grows past `maxKeys`.
 * @param {{max?: number, windowMs?: number, maxKeys?: number}} [options]
 * @return {{take: (key: string, now?: number) => boolean}}
 */
function createRateLimiter({max = 10, windowMs = 10 * 60 * 1000, maxKeys = 1000} = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  return {
    /** @param {string} key @param {number} [now] @return {boolean} Whether this call is within the limit (and counts it). */
    take(key, now = Date.now()) {
      if (hits.size > maxKeys) {
        for (const [k, times] of hits) if (!times.some(t => now - t < windowMs)) hits.delete(k);
      }
      const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

module.exports = {createQueue, createRateLimiter};
