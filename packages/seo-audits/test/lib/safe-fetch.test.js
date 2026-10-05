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
  publicOnlyLookup,
  safeFetchPublicPrefix,
  safeFetchJson,
  safeFetchStatus,
  safeFetchBytes,
  fetchJsonWithLookup,
  statusWithLookup,
  fetchBytesWithLookup,
  safeFetchPrefix,
  fetchPrefixWithLookup,
  ALLOW_PRIVATE_NETWORK_ENV,
  isBlockedAddress,
  isPermittedPrivateAddress,
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

describe('IPv6 literal handling (security review finding: bracketed IPv6 literals bypassed the check)', () => {
  it.each([
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex form (what URL parsing normalizes to)'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped cloud metadata address, hex form'],
    ['::ffff:a00:1', 'IPv4-mapped 10.0.0.1'],
    ['::ffff:c0a8:101', 'IPv4-mapped 192.168.1.1'],
    ['0:0:0:0:0:ffff:7f00:1', 'IPv4-mapped, fully expanded'],
    ['::ffff:127.0.0.1', 'IPv4-mapped, dotted form'],
    ['::127.0.0.1', 'deprecated IPv4-compatible'],
    ['::7f00:1', 'deprecated IPv4-compatible, hex'],
    ['64:ff9b::7f00:1', 'NAT64 wrapping 127.0.0.1'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 wrapping the metadata address'],
    ['2002:7f00:1::1', '6to4 wrapping 127.0.0.1'],
    ['2002:a9fe:a9fe::', '6to4 wrapping the metadata address'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation range'],
    ['fe80::1%eth0', 'zone-id link-local (unparseable: refused rather than guessed)'],
    ['::1', 'loopback'],
    ['fd00::1', 'unique-local'],
  ])('blocks %s (%s)', ip => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:808:808', // IPv4-mapped 8.8.8.8
    '64:ff9b::808:808', // NAT64 wrapping 8.8.8.8
    '2002:808:808::1', // 6to4 wrapping 8.8.8.8
  ])('does not block the ordinary public address %s', ip => {
    expect(isPrivateOrReservedIp(ip)).toBe(false);
  });

  const blockedLiterals = [
    'http://[::1]/sitemap.xml',
    'http://[::ffff:127.0.0.1]/sitemap.xml',
    'http://[::ffff:7f00:1]/sitemap.xml',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[fd00::1]/sitemap.xml',
    'http://[fe80::1]/sitemap.xml',
  ];

  it.each(blockedLiterals)('safeFetchBytes refuses %s before any connection', async url => {
    await expect(safeFetchBytes(url)).rejects.toThrow(/private\/reserved/);
  });

  it.each(blockedLiterals)('safeFetchJson refuses %s before any connection', async url => {
    await expect(safeFetchJson(url)).rejects.toThrow(/private\/reserved/);
  });

  it.each(blockedLiterals)('safeFetchStatus refuses %s before any connection', async url => {
    await expect(safeFetchStatus(url)).rejects.toThrow(/private\/reserved/);
  });

  it('still refuses IPv4 literals in decimal, hex and octal spellings', async () => {
    for (const url of ['http://2130706433/', 'http://0x7f.1/', 'http://017700000001/']) {
      await expect(safeFetchBytes(url)).rejects.toThrow(/private\/reserved/);
    }
  });
});

describe('private-network opt-in (LHCI_SEO_ALLOW_PRIVATE_NETWORK), for CI runs against your own hosts', () => {
  const original = process.env[ALLOW_PRIVATE_NETWORK_ENV];
  const setOptIn = value => {
    if (value === undefined) delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
    else process.env[ALLOW_PRIVATE_NETWORK_ENV] = value;
  };
  afterEach(() => setOptIn(original));

  describe('isPermittedPrivateAddress: the only addresses the opt-in can unblock', () => {
    it.each([
      '127.0.0.1',
      '127.5.5.5',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '::1',
      'fd00::1',
      'fc12::1',
      '::ffff:7f00:1',
      '::ffff:a00:1',
      '::ffff:c0a8:101',
    ])('permits %s', ip => {
      expect(isPermittedPrivateAddress(ip)).toBe(true);
    });

    it.each([
      ['169.254.169.254', 'cloud metadata'],
      ['169.254.1.1', 'link-local'],
      ['0.0.0.0', '"this network", reaches localhost on Linux'],
      ['100.64.0.1', 'carrier-grade NAT'],
      ['224.0.0.1', 'multicast'],
      ['172.32.0.1', 'just outside RFC 1918'],
      ['fe80::1', 'IPv6 link-local'],
      ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata address'],
      ['64:ff9b::7f00:1', 'NAT64 wrapping loopback'],
      ['2002:7f00:1::', '6to4 wrapping loopback'],
      ['ff02::1', 'IPv6 multicast'],
      ['::', 'unspecified'],
      ['2001:db8::1', 'documentation range'],
      ['8.8.8.8', 'public address (not private at all)'],
    ])('does not permit %s (%s)', ip => {
      expect(isPermittedPrivateAddress(ip)).toBe(false);
    });
  });

  describe('isBlockedAddress', () => {
    it('blocks private addresses when the variable is unset', () => {
      setOptIn(undefined);
      for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', 'fd00::1']) {
        expect(isBlockedAddress(ip)).toBe(true);
      }
    });

    it.each([['1'], ['true']])('unblocks loopback/RFC 1918/ULA when set to %s', value => {
      setOptIn(value);
      for (const ip of ['127.0.0.1', '10.0.0.1', '172.20.0.1', '192.168.1.1', '::1', 'fd00::1']) {
        expect(isBlockedAddress(ip)).toBe(false);
      }
    });

    it.each([[''], ['0'], ['false'], ['yes'], ['on'], [' 1']])(
      'does not treat %j as opting in (only exactly "1" or "true")',
      value => {
        setOptIn(value);
        expect(isBlockedAddress('127.0.0.1')).toBe(true);
      }
    );

    it('keeps metadata, link-local, 0.0.0.0, CGNAT and multicast blocked even when opted in', () => {
      setOptIn('1');
      for (const ip of [
        '169.254.169.254',
        '169.254.0.1',
        '0.0.0.0',
        '100.64.0.1',
        '224.0.0.1',
        'fe80::1',
        '::ffff:a9fe:a9fe',
        '64:ff9b::a9fe:a9fe',
        '2002:a9fe:a9fe::',
        'ff02::1',
        '::',
      ]) {
        expect(isBlockedAddress(ip)).toBe(true);
      }
    });

    it('never blocks an ordinary public address, opted in or not', () => {
      setOptIn(undefined);
      expect(isBlockedAddress('8.8.8.8')).toBe(false);
      setOptIn('1');
      expect(isBlockedAddress('8.8.8.8')).toBe(false);
    });
  });

  describe('through the real default fetch path, against a real local server', () => {
    /** @type {http.Server} */
    let server;
    let port = 0;
    beforeEach(async () => {
      server = http.createServer((req, res) => {
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('hello');
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
    });
    afterEach(async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    });

    it('refuses a loopback URL by default, and the refusal names the setting', async () => {
      setOptIn(undefined);
      await expect(safeFetchBytes(`http://127.0.0.1:${port}/`)).rejects.toThrow(
        /private\/reserved.*LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/
      );
    });

    it('fetches a literal-IP loopback URL when opted in', async () => {
      setOptIn('1');
      const result = await safeFetchBytes(`http://127.0.0.1:${port}/`);
      expect(result.status).toBe(200);
      expect(result.body.toString()).toBe('hello');
    });

    it('fetches a `localhost` hostname when opted in, through the real DNS lookup path', async () => {
      setOptIn('1');
      const result = await safeFetchBytes(`http://localhost:${port}/`);
      expect(result.status).toBe(200);
    });

    it('refuses the `localhost` hostname by default', async () => {
      setOptIn(undefined);
      await expect(safeFetchBytes(`http://localhost:${port}/`)).rejects.toThrow(
        /private\/reserved/
      );
    });

    it('reads the variable on every request: toggling it takes effect immediately', async () => {
      setOptIn('1');
      await expect(safeFetchBytes(`http://127.0.0.1:${port}/`)).resolves.toMatchObject({
        status: 200,
      });
      setOptIn(undefined);
      await expect(safeFetchBytes(`http://127.0.0.1:${port}/`)).rejects.toThrow(
        /private\/reserved/
      );
    });

    it('still refuses the metadata address, with no hint advertising the setting, when opted in', async () => {
      setOptIn('1');
      for (const url of [
        'http://169.254.169.254/latest/meta-data/',
        'http://[::ffff:169.254.169.254]/latest/meta-data/',
        'http://0.0.0.0/',
        'http://[fe80::1]/',
      ]) {
        const error = await safeFetchBytes(url).catch(e => e);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/private\/reserved/);
        expect(error.message).not.toContain('LHCI_SEO_ALLOW_PRIVATE_NETWORK');
      }
    });

    it('applies to safeFetchJson and safeFetchStatus too', async () => {
      setOptIn('1');
      await expect(safeFetchStatus(`http://127.0.0.1:${port}/`)).resolves.toEqual({status: 200});
      await expect(safeFetchJson(`http://127.0.0.1:${port}/`)).rejects.toThrow(/not valid JSON/);
      setOptIn(undefined);
      await expect(safeFetchStatus(`http://127.0.0.1:${port}/`)).rejects.toThrow(
        /private\/reserved/
      );
    });
  });
});

describe('statusWithLookup — redirect target, against a real local server', () => {
  /** @type {http.Server} */
  let server;
  let port = 0;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/moved') {
        res.writeHead(301, {Location: '/elsewhere'});
        res.end();
      } else {
        res.writeHead(200);
        res.end('ok');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const permissive = (hostname, options, callback) => callback(null, '127.0.0.1', 4);

  it('returns the Location of a redirect without following it', async () => {
    const result = await statusWithLookup(`http://127.0.0.1:${port}/moved`, permissive);
    expect(result).toEqual({status: 301, redirectLocation: '/elsewhere'});
  });

  it('returns a plain {status} when there is no Location, so existing callers are unchanged', async () => {
    const result = await statusWithLookup(`http://127.0.0.1:${port}/fine`, permissive);
    expect(result).toEqual({status: 200});
  });
});

describe('fetchPrefixWithLookup — request mechanics, against a real local server', () => {
  /** @type {http.Server} */
  let server;
  let port = 0;
  /** @type {Record<string, string | undefined>} */
  let lastRequestHeaders = {};
  const HTML = '<!doctype html><html><head><title>T</title></head><body>hello</body></html>';

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      lastRequestHeaders = /** @type {any} */ (req.headers);
      const path = req.url;
      if (path === '/page') {
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.end(HTML);
      } else if (path === '/xhtml') {
        res.writeHead(200, {'Content-Type': 'application/xhtml+xml'});
        res.end(HTML);
      } else if (path === '/no-content-type') {
        res.writeHead(200);
        res.end(HTML);
      } else if (path === '/identity') {
        res.writeHead(200, {'Content-Type': 'text/html', 'Content-Encoding': 'identity'});
        res.end(HTML);
      } else if (path === '/big') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('a'.repeat(200_000));
      } else if (path === '/exact') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('b'.repeat(1000));
      } else if (path === '/forever') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        const timer = setInterval(() => res.write('c'.repeat(4096)), 1);
        res.on('close', () => clearInterval(timer));
      } else if (path === '/stall') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write('<html><head><meta name="robots" content="noindex">');
        // never ends
      } else if (path === '/slow-headers') {
        // never responds at all
      } else if (path === '/pdf') {
        res.writeHead(200, {'Content-Type': 'application/pdf', 'X-Robots-Tag': 'noindex'});
        res.end('%PDF-1.4 ' + 'x'.repeat(5000));
      } else if (path === '/gzip') {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Encoding': 'gzip',
          'X-Robots-Tag': 'googlebot: noindex',
        });
        res.end(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));
      } else if (path === '/missing') {
        res.writeHead(404, {'Content-Type': 'text/html', 'X-Robots-Tag': 'noindex'});
        res.end('<html>not found</html>');
      } else if (path === '/moved') {
        res.writeHead(301, {Location: 'http://169.254.169.254/latest/meta-data/'});
        res.end();
      } else if (path === '/two-headers') {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('X-Robots-Tag', ['noindex', 'googlebot: nofollow']);
        res.writeHead(200);
        res.end(HTML);
      } else if (path === '/many-headers') {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader(
          'X-Robots-Tag',
          Array.from({length: 30}, (_, i) => `v${i}`)
        );
        res.setHeader('Set-Cookie', 'secret=1');
        res.setHeader('X-Other', 'ignored');
        res.writeHead(200);
        res.end(HTML);
      } else if (path === '/reset') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write('<html><head><title>partial');
        setTimeout(() => res.destroy(), 20);
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

  const permissive = (hostname, options, callback) => callback(null, '127.0.0.1', 4);
  const get = (path, options) =>
    fetchPrefixWithLookup(`http://127.0.0.1:${port}${path}`, permissive, options);

  it('reads a whole small HTML page, not truncated', async () => {
    const result = await get('/page');
    expect(result).toMatchObject({
      status: 200,
      bodyRead: 'html',
      truncated: false,
      redirectLocation: null,
    });
    expect(result.body.toString()).toBe(HTML);
    expect(result.headers['content-type']).toEqual(['text/html; charset=utf-8']);
  });

  it.each([['/xhtml'], ['/no-content-type'], ['/identity']])('also reads %s', async path => {
    const result = await get(path);
    expect(result.bodyRead).toBe('html');
    expect(result.body.toString()).toBe(HTML);
  });

  it('asks for an uncompressed body and for HTML', async () => {
    await get('/page');
    expect(lastRequestHeaders['accept-encoding']).toBe('identity');
    expect(lastRequestHeaders.accept).toContain('text/html');
  });

  it('stops at the byte cap and RESOLVES with a truncated prefix, not an error', async () => {
    const result = await get('/big', {maxBytes: 1000});
    expect(result.bodyRead).toBe('html');
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(1000);
  });

  it('does not call a body of exactly maxBytes truncated', async () => {
    const result = await get('/exact', {maxBytes: 1000});
    expect(result.body.length).toBe(1000);
    expect(result.truncated).toBe(false);
  });

  it('defaults to a 64 KiB prefix', async () => {
    const result = await get('/big');
    expect(result.body.length).toBe(64 * 1024);
    expect(result.truncated).toBe(true);
  });

  it('caps a never-ending text/html body quickly, without downloading it all', async () => {
    const started = Date.now();
    const result = await get('/forever', {maxBytes: 8192, timeoutMs: 4000});
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(8192);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('resolves with the partial body as truncated when the body stalls after its headers', async () => {
    const result = await get('/stall', {timeoutMs: 300});
    expect(result.bodyRead).toBe('html');
    expect(result.truncated).toBe(true);
    expect(result.body.toString()).toContain('noindex');
  }, 10000);

  it('resolves with the partial body as truncated when the connection is reset mid-body', async () => {
    const result = await get('/reset', {timeoutMs: 3000});
    expect(result.truncated).toBe(true);
    expect(result.body.toString()).toContain('partial');
  });

  it('rejects when nothing arrives before the deadline (slow headers)', async () => {
    await expect(get('/slow-headers', {timeoutMs: 200})).rejects.toThrow(/timed out after 200ms/);
  }, 10000);

  it('skips the body of a non-HTML response but still returns its headers', async () => {
    const result = await get('/pdf');
    expect(result).toMatchObject({status: 200, bodyRead: 'skipped-not-html', truncated: false});
    expect(result.body.length).toBe(0);
    expect(result.headers['x-robots-tag']).toEqual(['noindex']);
  });

  it('skips a compressed body (Node does not decompress) but keeps the headers', async () => {
    const result = await get('/gzip');
    expect(result.bodyRead).toBe('skipped-compressed');
    expect(result.body.length).toBe(0);
    expect(result.headers['content-encoding']).toEqual(['gzip']);
    expect(result.headers['x-robots-tag']).toEqual(['googlebot: noindex']);
  });

  it('skips the body of a non-2xx response, keeping its headers', async () => {
    const result = await get('/missing');
    expect(result).toMatchObject({status: 404, bodyRead: 'skipped-status'});
    expect(result.body.length).toBe(0);
    expect(result.headers['x-robots-tag']).toEqual(['noindex']);
  });

  it('returns a redirect with its Location and never follows it', async () => {
    const result = await get('/moved');
    expect(result).toMatchObject({status: 301, bodyRead: 'skipped-status'});
    expect(result.redirectLocation).toBe('http://169.254.169.254/latest/meta-data/');
  });

  it('returns every X-Robots-Tag occurrence separately, not merged into one string', async () => {
    const result = await get('/two-headers');
    expect(result.headers['x-robots-tag']).toEqual(['noindex', 'googlebot: nofollow']);
  });

  it('returns only allowlisted headers, capped in number', async () => {
    const result = await get('/many-headers');
    expect(Object.keys(result.headers).sort()).toEqual([
      'content-encoding',
      'content-type',
      'location',
      'x-robots-tag',
    ]);
    expect(result.headers['x-robots-tag']).toHaveLength(10);
    expect(JSON.stringify(result.headers)).not.toContain('secret');
  });

  it('rejects a non-http scheme and an invalid URL', async () => {
    await expect(fetchPrefixWithLookup('ftp://example.com/a', permissive)).rejects.toThrow(
      /scheme must be http/
    );
    await expect(fetchPrefixWithLookup('not a url', permissive)).rejects.toThrow(/not a valid URL/);
  });
});

describe('safeFetchPrefix — address policy through the real default path', () => {
  const original = process.env[ALLOW_PRIVATE_NETWORK_ENV];
  const setOptIn = value => {
    if (value === undefined) delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
    else process.env[ALLOW_PRIVATE_NETWORK_ENV] = value;
  };
  afterEach(() => setOptIn(original));

  /** @type {http.Server} */
  let server;
  let port = 0;
  beforeEach(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end('<html><head><meta name="robots" content="noindex"></head></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  it('refuses a loopback URL by default, naming the setting', async () => {
    setOptIn(undefined);
    await expect(safeFetchPrefix(`http://127.0.0.1:${port}/`)).rejects.toThrow(
      /private\/reserved.*LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/
    );
    await expect(safeFetchPrefix(`http://localhost:${port}/`)).rejects.toThrow(/private\/reserved/);
  });

  it('fetches a loopback page when opted in', async () => {
    setOptIn('1');
    const result = await safeFetchPrefix(`http://127.0.0.1:${port}/`);
    expect(result.bodyRead).toBe('html');
    expect(result.body.toString()).toContain('noindex');
    const viaName = await safeFetchPrefix(`http://localhost:${port}/`);
    expect(viaName.status).toBe(200);
  });

  it('still refuses the metadata address, IPv6 literals and 0.0.0.0 when opted in, with no hint', async () => {
    setOptIn('1');
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/latest/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://0.0.0.0/',
      'http://[fe80::1]/',
    ]) {
      const error = await safeFetchPrefix(url, {timeoutMs: 2000}).catch(e => e);
      expect(error.message).toMatch(/private\/reserved/);
      expect(error.message).not.toContain('LHCI_SEO_ALLOW_PRIVATE_NETWORK');
    }
  });

  it('refuses a non-http scheme and an invalid URL', async () => {
    await expect(safeFetchPrefix('file:///etc/passwd')).rejects.toThrow(/scheme must be http/);
    await expect(safeFetchPrefix('not a url')).rejects.toThrow(/not a valid URL/);
  });
});

describe('fetchPrefixWithLookup and safeFetchPrefix: the userAgent option', () => {
  /** @type {http.Server} */
  let server;
  let port = 0;
  /** @type {Array<Record<string, string | string[] | undefined>>} */
  let requests = [];

  beforeEach(async () => {
    requests = [];
    server = http.createServer((req, res) => {
      requests.push(req.headers);
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end('<html><head><title>x</title></head></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = /** @type {any} */ (server.address()).port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  /** @type {string[]} */
  let lookups = [];
  const spyLookup = (
    /** @type {string} */ hostname,
    /** @type {any} */ options,
    /** @type {any} */ callback
  ) => {
    lookups.push(hostname);
    // Node asks for every address (`all: true`) when connecting by host name.
    if (options && options.all) callback(null, [{address: '127.0.0.1', family: 4}]);
    else callback(null, '127.0.0.1', 4);
  };
  beforeEach(() => {
    lookups = [];
  });
  const url = () => `http://example.test:${port}/`;

  it('sends a valid user-agent as the User-Agent header', async () => {
    await fetchPrefixWithLookup(url(), spyLookup, {userAgent: 'lhci-seo-audits-crawler/1.0'});
    expect(requests).toHaveLength(1);
    expect(requests[0]['user-agent']).toBe('lhci-seo-audits-crawler/1.0');
  });

  it('accepts the shortest and the longest allowed values, and every printable ASCII character', async () => {
    await fetchPrefixWithLookup(url(), spyLookup, {userAgent: 'a'});
    await fetchPrefixWithLookup(url(), spyLookup, {userAgent: 'a'.repeat(200)});
    const printable = Array.from({length: 0x7e - 0x20 + 1}, (_, i) =>
      String.fromCharCode(0x20 + i)
    ).join('');
    await fetchPrefixWithLookup(url(), spyLookup, {userAgent: printable});
    expect(requests).toHaveLength(3);
    expect(requests[1]['user-agent']).toHaveLength(200);
  });

  it('sends no User-Agent header at all when the option is absent, and keeps the other headers', async () => {
    await fetchPrefixWithLookup(url(), spyLookup);
    await fetchPrefixWithLookup(url(), spyLookup, {timeoutMs: 2000, maxBytes: 1000});
    for (const headers of requests) {
      expect(headers['user-agent']).toBeUndefined();
      expect(headers['accept-encoding']).toBe('identity');
      expect(headers.accept).toMatch(/^text\/html/);
    }
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(201)],
    ['CRLF header injection', 'ok\r\nX-Injected: 1'],
    ['LF only', 'a\nb'],
    ['CR only', 'a\rb'],
    ['NUL', 'a\0b'],
    ['a tab', 'a\tb'],
    ['DEL', 'a\x7fb'],
    ['non-ASCII', 'café'],
    ['emoji', 'bot 🤖'],
    ['a number', 5],
    ['null', null],
    ['an object', {toString: () => 'x'}],
    ['an array', ['x']],
  ])('rejects %s before any DNS lookup or connection', async (_name, value) => {
    await expect(
      fetchPrefixWithLookup(url(), spyLookup, {userAgent: /** @type {any} */ (value)})
    ).rejects.toThrow(/userAgent must be 1 to 200 printable ASCII/);
    expect(lookups).toEqual([]);
    expect(requests).toEqual([]);
  });

  describe('through the real default path', () => {
    const original = process.env[ALLOW_PRIVATE_NETWORK_ENV];
    afterEach(() => {
      if (original === undefined) delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
      else process.env[ALLOW_PRIVATE_NETWORK_ENV] = original;
    });

    it('sends the header when opted in, and still refuses a loopback URL when not', async () => {
      process.env[ALLOW_PRIVATE_NETWORK_ENV] = '1';
      await safeFetchPrefix(`http://127.0.0.1:${port}/`, {userAgent: 'crawler/1'});
      expect(requests[0]['user-agent']).toBe('crawler/1');

      delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
      requests = [];
      await expect(
        safeFetchPrefix(`http://127.0.0.1:${port}/`, {userAgent: 'crawler/1'})
      ).rejects.toThrow(/private\/reserved/);
      expect(requests).toEqual([]);
    });

    it('rejects an invalid user-agent without a connection even when the address is allowed', async () => {
      process.env[ALLOW_PRIVATE_NETWORK_ENV] = '1';
      await expect(
        safeFetchPrefix(`http://127.0.0.1:${port}/`, {userAgent: 'bad\r\nHost: evil'})
      ).rejects.toThrow(/userAgent must be/);
      expect(requests).toEqual([]);
    });
  });
});

describe('fetchBytesWithLookup and safeFetchBytes: the userAgent option', () => {
  /** @type {http.Server} */
  let server;
  let port = 0;
  /** @type {Array<Record<string, string | string[] | undefined>>} */
  let requests = [];
  /** @type {string[]} */
  let lookups = [];

  beforeEach(async () => {
    requests = [];
    lookups = [];
    server = http.createServer((req, res) => {
      requests.push(req.headers);
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('User-agent: *');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = /** @type {any} */ (server.address()).port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const spyLookup = (
    /** @type {string} */ hostname,
    /** @type {any} */ options,
    /** @type {any} */ callback
  ) => {
    lookups.push(hostname);
    if (options && options.all) callback(null, [{address: '127.0.0.1', family: 4}]);
    else callback(null, '127.0.0.1', 4);
  };
  const url = () => `http://example.test:${port}/robots.txt`;

  it('sends a valid user-agent as the User-Agent header and still returns the body', async () => {
    const result = await fetchBytesWithLookup(url(), spyLookup, {
      userAgent: 'lhci-seo-audits-crawler/1.0',
    });
    expect(requests[0]['user-agent']).toBe('lhci-seo-audits-crawler/1.0');
    expect(result.status).toBe(200);
    expect(result.body.toString()).toBe('User-agent: *');
  });

  it('accepts the shortest and the longest allowed values', async () => {
    await fetchBytesWithLookup(url(), spyLookup, {userAgent: 'a'});
    await fetchBytesWithLookup(url(), spyLookup, {userAgent: 'a'.repeat(200)});
    expect(requests[1]['user-agent']).toHaveLength(200);
  });

  it('sends no User-Agent header when the option is absent, and keeps the Accept header', async () => {
    await fetchBytesWithLookup(url(), spyLookup);
    await fetchBytesWithLookup(url(), spyLookup, {timeoutMs: 2000, maxBytes: 1000});
    for (const headers of requests) {
      expect(headers['user-agent']).toBeUndefined();
      expect(headers.accept).toMatch(/application\/xml/);
    }
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(201)],
    ['CRLF header injection', 'ok\r\nX-Injected: 1'],
    ['NUL', 'a\0b'],
    ['a tab', 'a\tb'],
    ['non-ASCII', 'café'],
    ['a number', 5],
    ['null', null],
    ['an array', ['x']],
  ])('rejects %s before any DNS lookup or connection', async (_name, value) => {
    await expect(
      fetchBytesWithLookup(url(), spyLookup, {userAgent: /** @type {any} */ (value)})
    ).rejects.toThrow(/userAgent must be 1 to 200 printable ASCII/);
    expect(lookups).toEqual([]);
    expect(requests).toEqual([]);
  });

  describe('through the real default path', () => {
    const original = process.env[ALLOW_PRIVATE_NETWORK_ENV];
    afterEach(() => {
      if (original === undefined) delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
      else process.env[ALLOW_PRIVATE_NETWORK_ENV] = original;
    });

    it('sends the header when opted in, and still refuses a loopback URL when not', async () => {
      process.env[ALLOW_PRIVATE_NETWORK_ENV] = '1';
      await safeFetchBytes(`http://127.0.0.1:${port}/`, {userAgent: 'crawler/1'});
      expect(requests[0]['user-agent']).toBe('crawler/1');

      delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
      requests = [];
      await expect(
        safeFetchBytes(`http://127.0.0.1:${port}/`, {userAgent: 'crawler/1'})
      ).rejects.toThrow(/private\/reserved/);
      expect(requests).toEqual([]);
    });

    it('rejects an invalid user-agent without a connection even when the address is allowed', async () => {
      process.env[ALLOW_PRIVATE_NETWORK_ENV] = '1';
      await expect(
        safeFetchBytes(`http://127.0.0.1:${port}/`, {userAgent: 'bad\r\nHost: evil'})
      ).rejects.toThrow(/userAgent must be/);
      expect(requests).toEqual([]);
    });
  });
});

describe('safeFetchPublicPrefix and publicOnlyLookup: other people’s sites never reach a private address', () => {
  /** @type {http.Server} */
  let server;
  let port = 0;
  /** @type {string[]} */
  let requests = [];
  const original = process.env[ALLOW_PRIVATE_NETWORK_ENV];

  beforeEach(async () => {
    requests = [];
    server = http.createServer((req, res) => {
      requests.push(req.url || '');
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end('<html></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = /** @type {any} */ (server.address()).port;
    // The opt-in for auditing your own site is ON: it must make no difference here.
    process.env[ALLOW_PRIVATE_NETWORK_ENV] = '1';
  });
  afterEach(async () => {
    if (original === undefined) delete process.env[ALLOW_PRIVATE_NETWORK_ENV];
    else process.env[ALLOW_PRIVATE_NETWORK_ENV] = original;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['a private 10.x address', '10.0.0.5'],
    ['a private 192.168.x address', '192.168.1.1'],
    ['a private 172.16.x address', '172.16.0.9'],
    ['the cloud metadata address', '169.254.169.254'],
    ['IPv6 loopback', '[::1]'],
    ['an IPv4-mapped loopback', '[::ffff:127.0.0.1]'],
    ['an IPv6 unique-local address', '[fd00::1]'],
    ['0.0.0.0', '0.0.0.0'],
  ])(
    'refuses %s even with the private-network opt-in on, without connecting',
    async (_name, host) => {
      await expect(safeFetchPublicPrefix(`http://${host}:${port}/x`)).rejects.toThrow(
        /private\/reserved/
      );
      expect(requests).toEqual([]);
    }
  );

  it('does not suggest the opt-in in its refusal', async () => {
    await expect(safeFetchPublicPrefix(`http://127.0.0.1:${port}/`)).rejects.not.toThrow(
      /LHCI_SEO_ALLOW/
    );
  });

  it('refuses a host name that resolves to a private address, even with the opt-in on', async () => {
    // `localhost` resolves to loopback: allowed for the audited site by the opt-in, never for another site.
    await expect(safeFetchPublicPrefix(`http://localhost:${port}/x`)).rejects.toThrow(
      /private\/reserved/
    );
    expect(requests).toEqual([]);
  });

  it('is stricter than the audited-site fetch, which the same opt-in does allow', async () => {
    const result = await safeFetchPrefix(`http://127.0.0.1:${port}/ok`);
    expect(result.status).toBe(200);
    expect(requests).toEqual(['/ok']);
  });

  it('rejects an invalid user-agent before any lookup or connection', async () => {
    await expect(
      safeFetchPublicPrefix('https://example.org/', {userAgent: 'bad\r\nHost: evil'})
    ).rejects.toThrow(/userAgent must be/);
  });

  it('lets a public literal address through its lookup and still blocks private ones, in both reply shapes', async () => {
    /** @param {string} host @param {boolean} all */
    const resolve = (host, all) =>
      new Promise(done => {
        publicOnlyLookup(host, {all}, (/** @type {any} */ err, /** @type {any} */ address) =>
          done({err, address})
        );
      });
    const pub = /** @type {any} */ (await resolve('93.184.216.34', true));
    expect(pub.err).toBeNull();
    expect(pub.address).toEqual([{address: '93.184.216.34', family: 4}]);
    const single = /** @type {any} */ (await resolve('93.184.216.34', false));
    expect(single.address).toBe('93.184.216.34');
    for (const host of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', 'fd12::1']) {
      const refused = /** @type {any} */ (await resolve(host, true));
      expect(refused.err).toBeInstanceOf(Error);
      expect(String(refused.err.message)).toMatch(/private\/reserved/);
    }
  });
});
