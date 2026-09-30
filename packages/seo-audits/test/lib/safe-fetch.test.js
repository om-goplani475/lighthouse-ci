/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const http = require('http');
const {
  isPrivateOrReservedIp,
  safeLookup,
  safeFetchJson,
  safeFetchStatus,
  safeFetchBytes,
  fetchJsonWithLookup,
  statusWithLookup,
  fetchBytesWithLookup,
} = require('../../src/lib/safe-fetch.js');

describe('isPrivateOrReservedIp', () => {
  it('blocks RFC 1918 private ranges', () => {
    expect(isPrivateOrReservedIp('10.1.2.3')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
  });

  it('blocks loopback', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
  });

  it('blocks link-local, including the cloud metadata address', () => {
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.0.1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 addresses that wrap a private IPv4', () => {
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
  });

  it('blocks IPv6 unique-local and link-local ranges', () => {
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('fd12:3456::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
  });

  it('does not block ordinary public addresses', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
  });
});

describe('safeLookup', () => {
  it('rejects a literal private IPv4 address without a DNS round-trip', done => {
    safeLookup('127.0.0.1', {}, err => {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/private\/reserved/);
      done();
    });
  });

  it('rejects the literal cloud metadata address', done => {
    safeLookup('169.254.169.254', {}, err => {
      expect(err).toBeInstanceOf(Error);
      done();
    });
  });

  it('accepts a literal public IPv4 address', done => {
    safeLookup('8.8.8.8', {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe('8.8.8.8');
      expect(family).toBe(4);
      done();
    });
  });

  /**
   * Regression coverage for a real bug found during Phase 3 live QA: Node's own `net.connect`
   * requests `{all: true}` whenever Happy Eyeballs is active (the default since Node 20 —
   * `net.getDefaultAutoSelectFamily()`), which is the normal case for any real `http.request` to
   * a hostname, not an edge case. `safeLookup` used to always reply with a single `(address,
   * family)` tuple regardless of what was asked for, which made Node's own connect logic throw
   * `Invalid IP address: undefined` — silently breaking every real outbound fetch to a
   * non-literal-IP hostname (this would have broken `manifest-icons` in production against any
   * real domain, not just the newly-added `open-graph-image-reachable`).
   */
  describe('options.all support (Happy Eyeballs)', () => {
    it('replies with an array for a literal public IP when options.all is requested', done => {
      safeLookup('8.8.8.8', {all: true}, (err, addresses) => {
        expect(err).toBeNull();
        expect(addresses).toEqual([{address: '8.8.8.8', family: 4}]);
        done();
      });
    });

    it('still rejects a literal private IP when options.all is requested', done => {
      safeLookup('127.0.0.1', {all: true}, err => {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/private\/reserved/);
        done();
      });
    });

    // A real (non-literal-IP) hostname's options.all path is covered live, not with a unit test
    // against real DNS — this repo's own convention is not to give the Jest suite a live-network
    // dependency (see CLAUDE.md's "this repo does not hit live URLs in tests"). See
    // docs/qa/social-metadata.md for the live confirmation against a real external hostname
    // (the exact scenario that surfaced this bug in the first place).
  });
});

describe('safeFetchJson — integration against a real local server', () => {
  it('refuses to fetch a loopback URL — the SSRF protection actually blocks the connection, not just documented as should-block', async () => {
    // A real local server, deliberately not connected to: the block must happen before any
    // connection attempt, from the private-IP check alone.
    await expect(safeFetchJson('http://127.0.0.1:1/whatever')).rejects.toThrow(/private\/reserved/);
  });

  it('refuses a non-http(s) scheme', async () => {
    await expect(safeFetchJson('file:///etc/passwd')).rejects.toThrow(/must be http or https/);
  });
});

describe('safeFetchStatus — integration against a real local server', () => {
  it('refuses to fetch a loopback URL — same SSRF protection as safeFetchJson', async () => {
    await expect(safeFetchStatus('http://127.0.0.1:1/whatever')).rejects.toThrow(
      /private\/reserved/
    );
  });

  it('refuses a non-http(s) scheme', async () => {
    await expect(safeFetchStatus('file:///etc/passwd')).rejects.toThrow(/must be http or https/);
  });
});

/**
 * A deliberately permissive lookup (real DNS resolution, but never blocks anything) — used only
 * to test `fetchJsonWithLookup`'s request mechanics (timeout, size cap, JSON parsing, status
 * handling) against a real local server. `safeFetchJson`'s public API has no way to accept this;
 * see the module's own comment on why that's structural, not just documented.
 * @type {import('../../src/lib/safe-fetch.js').safeLookup}
 */
function permissiveLookup(hostname, options, callback) {
  callback(null, '127.0.0.1', 4);
}

describe('fetchJsonWithLookup — request mechanics, against a real local server', () => {
  /** @type {http.Server} */
  let server;
  /** @type {number} */
  let port;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/valid.json') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({icons: [{src: 'icon.png', sizes: '192x192'}]}));
      } else if (req.url === '/not-found') {
        res.writeHead(404);
        res.end('not found');
      } else if (req.url === '/not-json') {
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('this is not json');
      } else if (req.url === '/too-big') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({padding: 'x'.repeat(2_000_000)}));
      } else if (req.url === '/slow') {
        // Never responds — exercises the timeout path.
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('fetches and parses valid JSON', async () => {
    const result = await fetchJsonWithLookup(
      `http://127.0.0.1:${port}/valid.json`,
      permissiveLookup
    );
    expect(result).toEqual({icons: [{src: 'icon.png', sizes: '192x192'}]});
  });

  it('rejects a non-2xx response', async () => {
    await expect(
      fetchJsonWithLookup(`http://127.0.0.1:${port}/not-found`, permissiveLookup)
    ).rejects.toThrow(/HTTP 404/);
  });

  it('rejects invalid JSON', async () => {
    await expect(
      fetchJsonWithLookup(`http://127.0.0.1:${port}/not-json`, permissiveLookup)
    ).rejects.toThrow(/not valid JSON/);
  });

  it('rejects a response exceeding the byte cap', async () => {
    await expect(
      fetchJsonWithLookup(`http://127.0.0.1:${port}/too-big`, permissiveLookup, {
        maxBytes: 1000,
      })
    ).rejects.toThrow(/exceeded/);
  });

  it('rejects after the timeout elapses', async () => {
    await expect(
      fetchJsonWithLookup(`http://127.0.0.1:${port}/slow`, permissiveLookup, {timeoutMs: 200})
    ).rejects.toThrow(/timed out/);
  }, 10000);
});

describe('statusWithLookup — request mechanics, against a real local server', () => {
  /** @type {http.Server} */
  let server;
  /** @type {number} */
  let port;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, {'Content-Type': 'image/png'});
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      } else if (req.url === '/not-found') {
        res.writeHead(404);
        res.end('not found');
      } else if (req.url === '/slow') {
        // Never responds — exercises the timeout path.
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('resolves with the status code without needing the response body to be valid JSON', async () => {
    const result = await statusWithLookup(`http://127.0.0.1:${port}/ok`, permissiveLookup);
    expect(result).toEqual({status: 200});
  });

  it('resolves with a non-2xx status rather than rejecting — the caller decides what counts as failure', async () => {
    const result = await statusWithLookup(`http://127.0.0.1:${port}/not-found`, permissiveLookup);
    expect(result).toEqual({status: 404});
  });

  it('rejects after the timeout elapses', async () => {
    await expect(
      statusWithLookup(`http://127.0.0.1:${port}/slow`, permissiveLookup, {timeoutMs: 200})
    ).rejects.toThrow(/timed out/);
  }, 10000);
});

describe('safeFetchBytes — integration against a real local server', () => {
  it('refuses to fetch a loopback URL — same SSRF protection as safeFetchJson', async () => {
    await expect(safeFetchBytes('http://127.0.0.1:1/sitemap.xml')).rejects.toThrow(
      /private\/reserved/
    );
  });

  it('refuses the cloud metadata address', async () => {
    await expect(safeFetchBytes('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private\/reserved/
    );
  });

  it('refuses a non-http(s) scheme and an invalid URL', async () => {
    await expect(safeFetchBytes('file:///etc/passwd')).rejects.toThrow(/scheme must be http/);
    await expect(safeFetchBytes('not a url')).rejects.toThrow(/not a valid URL/);
  });
});

describe('fetchBytesWithLookup — request mechanics, against a real local server', () => {
  /** @type {http.Server} */
  let server;
  /** @type {number} */
  let port;
  const binary = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x80, 0x7f]);

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/binary') {
        res.writeHead(200, {'Content-Type': 'application/gzip'});
        res.end(binary);
      } else if (req.url === '/not-found') {
        res.writeHead(404);
        res.end('missing');
      } else if (req.url === '/moved') {
        res.writeHead(301, {Location: 'http://169.254.169.254/latest/meta-data/'});
        res.end();
      } else if (req.url === '/too-big') {
        res.writeHead(200);
        res.end(Buffer.alloc(2000, 0x61));
      } else if (req.url === '/trickle') {
        // One byte every 50ms, forever: never idle long enough to trip a socket idle timeout.
        res.writeHead(200);
        const timer = setInterval(() => res.write('x'), 50);
        res.on('close', () => clearInterval(timer));
      } else if (req.url === '/slow') {
        // Never responds.
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const get = (path, options) =>
    fetchBytesWithLookup(`http://127.0.0.1:${port}${path}`, permissiveLookup, options);

  it('returns the exact bytes, including non-text binary content', async () => {
    const result = await get('/binary');
    expect(result.status).toBe(200);
    expect(Buffer.compare(result.body, binary)).toBe(0);
    expect(result.redirectLocation).toBeNull();
  });

  it('returns a non-2xx status rather than rejecting', async () => {
    const result = await get('/not-found');
    expect(result.status).toBe(404);
    expect(result.body.toString()).toBe('missing');
  });

  it('returns a redirect with its Location and does not follow it', async () => {
    const result = await get('/moved');
    expect(result.status).toBe(301);
    expect(result.redirectLocation).toBe('http://169.254.169.254/latest/meta-data/');
    expect(result.body.length).toBe(0);
  });

  it('rejects a response exceeding the byte cap', async () => {
    await expect(get('/too-big', {maxBytes: 1000})).rejects.toThrow(/exceeded 1000 bytes/);
  });

  it('rejects a server that never responds after the timeout', async () => {
    await expect(get('/slow', {timeoutMs: 200})).rejects.toThrow(/timed out/);
  }, 10000);

  it('enforces a total deadline even when the server keeps trickling bytes', async () => {
    await expect(get('/trickle', {timeoutMs: 300})).rejects.toThrow(/timed out/);
  }, 10000);

  it('rejects a non-http scheme', async () => {
    await expect(fetchBytesWithLookup('ftp://example.com/a.xml', permissiveLookup)).rejects.toThrow(
      /scheme must be http/
    );
  });
});
