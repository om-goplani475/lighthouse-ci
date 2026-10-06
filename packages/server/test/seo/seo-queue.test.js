/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/* eslint-env jest */

const {createQueue, createRateLimiter} = require('../../src/seo/seo-queue.js');

describe('createQueue', () => {
  it('runs jobs one at a time in order and reports idle', async () => {
    const order = [];
    let active = 0;
    let peak = 0;
    const queue = createQueue({
      maxQueued: 5,
      execute: async job => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(r => setTimeout(r, 5));
        order.push(job);
        active--;
      },
    });
    [1, 2, 3].forEach(j => queue.push(j));
    await queue.idle();
    expect(order).toEqual([1, 2, 3]);
    expect(peak).toBe(1);
    expect(queue.size()).toBe(0);
  });

  it('refuses a job when full, and a throwing job does not stop the rest', async () => {
    const done = [];
    const queue = createQueue({
      maxQueued: 1,
      execute: async job => {
        if (job === 'bad') throw new Error('x');
        done.push(job);
      },
    });
    expect(queue.push('bad')).toBe(true); // starts at once
    expect(queue.push('a')).toBe(true); // waits
    expect(queue.push('b')).toBe(false); // full
    await queue.idle();
    expect(done).toEqual(['a']);
  });
});

describe('createRateLimiter', () => {
  it('allows `max` per window, then again after it', () => {
    const limiter = createRateLimiter({max: 2, windowMs: 1000});
    expect(limiter.take('p', 0)).toBe(true);
    expect(limiter.take('p', 10)).toBe(true);
    expect(limiter.take('p', 20)).toBe(false);
    expect(limiter.take('other', 20)).toBe(true);
    expect(limiter.take('p', 1005)).toBe(true);
  });

  it('forgets idle keys so the map stays bounded', () => {
    const limiter = createRateLimiter({max: 1, windowMs: 10, maxKeys: 5});
    for (let i = 0; i < 100; i++) limiter.take(`k${i}`, i * 100);
    expect(limiter.take('k0', 10000)).toBe(true);
  });
});
