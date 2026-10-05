/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {queryCrux, HOST, PATH, METRICS} = require('../../src/lib/crux-client.js');

const KEY = 'AIzaSyFAKEKEY-1234567890';
const ok = (/** @type {any} */ record) => async () => ({
  status: 200,
  body: JSON.stringify({record}),
});

describe('queryCrux', () => {
  it('posts to the fixed host with the key in a header only', async () => {
    const post = jest.fn(ok({metrics: {largest_contentful_paint: {}}}));
    const result = await queryCrux({
      apiKey: KEY,
      target: {url: 'https://example.com/a'},
      formFactor: 'PHONE',
      post,
    });
    expect(result.state).toBe('ok');
    const call = post.mock.calls[0][0];
    expect(call.host).toBe(HOST);
    expect(call.path).toBe(PATH);
    expect(call.headers['X-Goog-Api-Key']).toBe(KEY);
    expect(call.path).not.toContain(KEY);
    expect(call.body).not.toContain(KEY);
    expect(JSON.parse(call.body)).toEqual({
      url: 'https://example.com/a',
      formFactor: 'PHONE',
      metrics: METRICS,
    });
    expect(call.headers['Content-Length']).toBe(Buffer.byteLength(call.body));
  });

  it('sends an origin target and no form factor when none is given', async () => {
    const post = jest.fn(ok({metrics: {}}));
    await queryCrux({apiKey: KEY, target: {origin: 'https://example.com'}, post});
    expect(JSON.parse(post.mock.calls[0][0].body)).toEqual({
      origin: 'https://example.com',
      metrics: METRICS,
    });
  });

  it('reports 404 and an empty record as no data', async () => {
    expect(
      await queryCrux({
        apiKey: KEY,
        target: {url: 'https://e.com/'},
        post: async () => ({status: 404, body: '{}'}),
      })
    ).toEqual({state: 'no-data'});
    expect(
      (await queryCrux({apiKey: KEY, target: {url: 'https://e.com/'}, post: ok({})})).state
    ).toBe('no-data');
    expect(
      (
        await queryCrux({
          apiKey: KEY,
          target: {url: 'https://e.com/'},
          post: async () => ({status: 200, body: 'null'}),
        })
      ).state
    ).toBe('no-data');
  });

  it('turns API errors into a reason with a hint, never the key', async () => {
    const run = (/** @type {number} */ status) =>
      queryCrux({
        apiKey: KEY,
        target: {url: 'https://e.com/'},
        post: async () => ({status, body: `error for ${KEY}`}),
      });
    expect(await run(403)).toEqual({
      state: 'error',
      reason: expect.stringContaining('answered 403 (check the key'),
    });
    expect(await run(429)).toEqual({state: 'error', reason: expect.stringContaining('quota')});
    expect(await run(500)).toEqual({state: 'error', reason: 'the CrUX API answered 500'});
  });

  it('never leaks the key through a thrown error or bad JSON', async () => {
    const thrown = await queryCrux({
      apiKey: KEY,
      target: {url: 'https://e.com/'},
      post: async () => {
        throw new Error(`connect failed using ${KEY}`);
      },
    });
    expect(thrown.state).toBe('error');
    expect(JSON.stringify(thrown)).not.toContain(KEY);
    const bad = await queryCrux({
      apiKey: KEY,
      target: {url: 'https://e.com/'},
      post: async () => ({status: 200, body: `{not json ${KEY}`}),
    });
    expect(bad.state).toBe('error');
    expect(JSON.stringify(bad)).not.toContain(KEY);
  });
});
