/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const http = require('http');
const {createOutbound} = require('../../src/service/outbound.js');

const localLookup = (host, options, cb) =>
  options && options.all ? cb(null, [{address: '127.0.0.1', family: 4}]) : cb(null, '127.0.0.1', 4);

function server(handler) {
  const seen = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      seen.push({method: req.method, url: req.url, headers: req.headers, body});
      handler(req, res);
    });
  });
  return new Promise(resolve =>
    s.listen(0, '127.0.0.1', () =>
      resolve({port: s.address().port, seen, close: () => new Promise(r => s.close(r))})
    )
  );
}

describe('createOutbound', () => {
  let s;
  afterEach(async () => {
    if (s) await s.close();
    s = null;
  });
  const test = options => createOutbound({lookup: localLookup, allowHttp: true, ...options});

  it('sends JSON with the headers given and parses a JSON reply', async () => {
    s = await server((req, res) => res.end('{"ok":true}'));
    const res = await test()({
      method: 'POST',
      url: `http://x.test:${s.port}/a?b=1`,
      headers: {authorization: 'Bearer t'},
      body: {hi: 1},
    });
    expect(res).toMatchObject({status: 200, json: {ok: true}});
    expect(s.seen[0]).toMatchObject({method: 'POST', url: '/a?b=1', body: '{"hi":1}'});
    expect(s.seen[0].headers.authorization).toBe('Bearer t');
    expect(s.seen[0].headers['content-type']).toBe('application/json');
    expect(s.seen[0].headers['user-agent']).toBe('lhci-seo-service');
  });

  it('returns non-JSON text and error statuses without throwing', async () => {
    s = await server((req, res) => {
      res.writeHead(502);
      res.end('bad gateway');
    });
    const res = await test()({method: 'GET', url: `http://x.test:${s.port}/`});
    expect(res).toMatchObject({status: 502, text: 'bad gateway', json: null});
  });

  it('does not follow a redirect (it could carry a token to another host)', async () => {
    s = await server((req, res) => {
      res.writeHead(302, {location: 'http://169.254.169.254/'});
      res.end();
    });
    const res = await test()({
      method: 'GET',
      url: `http://x.test:${s.port}/`,
      headers: {authorization: 'Bearer t'},
    });
    expect(res.status).toBe(302);
    expect(s.seen).toHaveLength(1);
  });

  it('gives up on a slow server and on an oversize response', async () => {
    s = await server(() => {});
    await expect(
      test({timeoutMs: 100})({method: 'GET', url: `http://x.test:${s.port}/`})
    ).rejects.toThrow(/timed out/);
    await s.close();
    s = await server((req, res) => res.end('x'.repeat(5000)));
    await expect(
      test({maxBytes: 1000})({method: 'GET', url: `http://x.test:${s.port}/`})
    ).rejects.toThrow(/too large/);
  });

  it('refuses plain http, credentials and bad urls in production mode', async () => {
    const send = createOutbound();
    await expect(send({method: 'GET', url: 'http://example.com/'})).rejects.toThrow(
      /must use https/
    );
    await expect(send({method: 'GET', url: 'https://u:p@example.com/'})).rejects.toThrow(
      /credentials/
    );
    await expect(send({method: 'GET', url: 'nope'})).rejects.toThrow(/not a valid URL/);
  });

  it('refuses private addresses in production mode, by literal and by name', async () => {
    const send = createOutbound();
    for (const url of [
      'https://127.0.0.1/',
      'https://169.254.169.254/',
      'https://[::1]/',
      'https://10.0.0.1/',
      'https://localhost/',
    ]) {
      await expect(send({method: 'GET', url})).rejects.toThrow(/refusing to connect/);
    }
  });
});
