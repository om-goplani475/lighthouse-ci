/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const http = require('http');
const net = require('net');
const {
  createGuardProxy,
  assertPublicHost,
  parseHostPort,
} = require('../../src/service/guard-proxy.js');

/** A local "origin" the tests treat as a public host. @return {Promise<{port: number, hits: string[], close: () => Promise<void>}>} */
function origin() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/redirect') {
      res.writeHead(302, {location: 'http://169.254.169.254/latest/meta-data/'});
      return res.end();
    }
    res.writeHead(200, {
      'content-type': 'text/plain',
      connection: 'close',
      'x-seen-host': req.headers.host,
    });
    res.end('hello');
  });
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        hits,
        close: () => new Promise(r => server.close(r)),
      })
    )
  );
}

/** Sends a request the way Chrome does to an HTTP proxy. */
function viaProxy(proxyPort, target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path: target,
        method,
        headers: {host: target.startsWith('/') ? 'x' : new URL(target).host},
      },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** Sends a CONNECT and returns the proxy's status line. */
function connectVia(proxyPort, hostPort) {
  return new Promise(resolve => {
    const socket = net.connect(proxyPort, '127.0.0.1', () =>
      socket.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`)
    );
    let data = '';
    socket.on('data', c => {
      data += c.toString();
      if (data.includes('\r\n\r\n')) {
        resolve({line: data.split('\r\n')[0], socket});
      }
    });
    socket.on('error', () => resolve({line: 'error', socket}));
    socket.on('close', () => resolve({line: data.split('\r\n')[0] || 'closed', socket}));
  });
}

// A lookup that treats every name as the local test origin, so the proxy's mechanics can be tested without the network.
const localLookup = (host, options, cb) =>
  options && options.all ? cb(null, [{address: '127.0.0.1', family: 4}]) : cb(null, '127.0.0.1', 4);

describe('guard proxy (mechanics, with a permissive test lookup)', () => {
  let proxy;
  let site;
  beforeEach(async () => {
    site = await origin();
    proxy = await createGuardProxy({lookup: localLookup, allowedPorts: [site.port]});
  });
  afterEach(async () => {
    await proxy.close();
    await site.close();
  });

  it('forwards an http request and passes the response through', async () => {
    const res = await viaProxy(proxy.port, `http://example.test:${site.port}/page`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('hello');
    expect(res.headers['x-seen-host']).toBe(`example.test:${site.port}`);
    expect(site.hits).toEqual(['/page']);
  });

  it('listens on loopback only', () => {
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('tunnels CONNECT to an allowed port', async () => {
    const {line, socket} = await connectVia(proxy.port, `example.test:${site.port}`);
    expect(line).toBe('HTTP/1.1 200 Connection Established');
    socket.destroy();
  });

  it('refuses a port that is not allowed, for both CONNECT and http', async () => {
    expect((await connectVia(proxy.port, 'example.test:25')).line).toBe('HTTP/1.1 403 Forbidden');
    expect((await viaProxy(proxy.port, 'http://example.test:25/')).status).toBe(403);
    expect(proxy.denied.length).toBe(2);
    expect(proxy.blocked).toEqual([]);
  });

  it('refuses a request that is not an absolute http url (it is a proxy, not a web server)', async () => {
    expect((await viaProxy(proxy.port, '/just-a-path')).status).toBe(400);
    expect((await viaProxy(proxy.port, `https://example.test:${site.port}/`)).status).toBe(403);
  });

  it('answers 502 when the upstream is down, without crashing', async () => {
    await site.close();
    const res = await viaProxy(proxy.port, `http://example.test:${site.port}/`);
    expect(res.status).toBe(502);
    site = await origin(); // so afterEach can close it
  });
});

describe('guard proxy (real address policy)', () => {
  let proxy;
  beforeEach(async () => {
    proxy = await createGuardProxy({allowedPorts: [80, 443, 8080, 8443, 3000]});
  });
  afterEach(() => proxy.close());

  it.each([
    ['loopback', 'http://127.0.0.1:3000/'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a private range', 'http://10.0.0.5:8080/'],
    ['an IPv6 loopback', 'http://[::1]:3000/'],
    ['an IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]:3000/'],
    ['a name that resolves to loopback', 'http://localhost:3000/'],
  ])('refuses http to %s', async (_, url) => {
    const res = await viaProxy(proxy.port, url);
    expect(res.status).toBe(403);
    expect(proxy.blocked.length).toBeGreaterThan(0);
  });

  it.each([
    ['loopback', '127.0.0.1:443'],
    ['the cloud metadata address', '169.254.169.254:443'],
    ['an IPv6 loopback', '[::1]:443'],
    ['localhost', 'localhost:443'],
  ])(
    'refuses a CONNECT tunnel to %s, even with the private-network opt-in set',
    async (_, target) => {
      const before = process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
      process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK = '1';
      try {
        const {line, socket} = await connectVia(proxy.port, target);
        expect(line).toMatch(/^HTTP\/1\.1 403/);
        socket.destroy();
      } finally {
        if (before === undefined) delete process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
        else process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK = before;
      }
    }
  );

  it('records what it blocked, and caps the record', async () => {
    for (let i = 0; i < 60; i++) await viaProxy(proxy.port, `http://10.0.0.${i}:8080/`);
    expect(proxy.blocked).toHaveLength(50);
    expect(proxy.blocked[0].host).toBe('10.0.0.0');
  });
});

describe('assertPublicHost and parseHostPort', () => {
  it('rejects private literals and names that resolve to them', async () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '[::1]', 'localhost']) {
      await expect(assertPublicHost(host)).rejects.toThrow(/refusing to connect/);
    }
  });

  it('accepts a public literal', async () => {
    await expect(assertPublicHost('93.184.216.34')).resolves.toBeUndefined();
  });

  it('parses host:port and rejects junk', () => {
    expect(parseHostPort('example.com:443')).toEqual({host: 'example.com', port: 443});
    expect(parseHostPort('[::1]:8443')).toEqual({host: '::1', port: 8443});
    for (const bad of ['example.com', 'a b:443', ':443', 'x:99999x', '', undefined]) {
      expect(parseHostPort(bad)).toBeNull();
    }
  });
});
