/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runs `collectSitemapDocuments` against a real local HTTP server, through the real request code
 * (`fetchBytesWithLookup`) with the test-only permissive lookup — never `safeLookup` (which would
 * correctly refuse 127.0.0.1) and never a live URL. Covers what the injected-fetcher unit tests
 * cannot: real gzip bytes over the wire, a real 301, a real slow server, a real over-cap body.
 *
 * This is also the failure-path driver for live QA: `lhci collect` against a localhost page cannot
 * reach a local sitemap by design (private addresses are blocked), so failure behavior is
 * verified here rather than by weakening the SSRF policy.
 */

/* eslint-env jest */

const http = require('http');
const zlib = require('zlib');
const {fetchBytesWithLookup} = require('../../src/lib/safe-fetch.js');
const {collectSitemapDocuments} = require('../../src/gatherers/sitemap-documents.js');
const {SITEMAP_NAMESPACE} = require('../../src/lib/sitemap-parse.js');

const NS = SITEMAP_NAMESPACE;
const permissiveLookup = (hostname, options, callback) => callback(null, '127.0.0.1', 4);

const urlset = (...locs) =>
  `<urlset xmlns="${NS}">${locs.map(l => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;

describe('collectSitemapDocuments — against a real local server', () => {
  /** @type {http.Server} */
  let server;
  let base = '';
  /** @type {Record<string, (res: http.ServerResponse) => void>} */
  let routes = {};

  beforeEach(async () => {
    routes = {};
    server = http.createServer((req, res) => {
      const handler = routes[req.url];
      if (handler) handler(res);
      else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  /**
   * @param {{timeoutMs?: number, maxBytes?: number}} [overrides] Tighter bounds so tests stay fast.
   */
  const collect = overrides =>
    collectSitemapDocuments(
      {finalDisplayedUrl: `${base}/page`},
      {
        fetchBytes: (url, opts) =>
          fetchBytesWithLookup(url, permissiveLookup, {...opts, ...overrides}),
      }
    );

  const ok = (res, body, headers = {}) => {
    res.writeHead(200, headers);
    res.end(body);
  };

  it('discovers via robots.txt and parses a real gzip sitemap served over HTTP', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/s.xml.gz`);
    routes['/s.xml.gz'] = res =>
      ok(res, zlib.gzipSync(Buffer.from(urlset(`${base}/a`, `${base}/b`))), {
        'Content-Type': 'application/gzip',
      });
    const artifact = await collect();
    expect(artifact.discovery).toBe('robots-txt');
    expect(artifact.documents[0]).toMatchObject({
      outcome: 'ok',
      gzip: true,
      kind: 'urlset',
      locs: [`${base}/a`, `${base}/b`],
    });
  });

  it('parses gzip bytes served under a plain .xml URL (detected by magic bytes)', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/sitemap.xml`);
    routes['/sitemap.xml'] = res =>
      ok(res, zlib.gzipSync(Buffer.from(urlset(`${base}/a`))), {'Content-Encoding': 'gzip'});
    const artifact = await collect();
    expect(artifact.documents[0]).toMatchObject({gzip: true, kind: 'urlset', outcome: 'ok'});
  });

  it('follows a real sitemap index and reports a real 404 child', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/index.xml`);
    routes['/index.xml'] = res =>
      ok(
        res,
        `<sitemapindex xmlns="${NS}"><sitemap><loc>${base}/s1.xml</loc></sitemap><sitemap><loc>${base}/gone.xml</loc></sitemap></sitemapindex>`
      );
    routes['/s1.xml'] = res => ok(res, urlset(`${base}/a`));
    const artifact = await collect();
    expect(artifact.documents.map(d => [d.source, d.outcome])).toEqual([
      ['declared', 'ok'],
      ['index-child', 'ok'],
      ['index-child', 'http-error'],
    ]);
  });

  it('reports a real 301 with its Location and never follows it', async () => {
    let followed = false;
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/old.xml`);
    routes['/old.xml'] = res => {
      res.writeHead(301, {Location: `${base}/new.xml`});
      res.end();
    };
    routes['/new.xml'] = res => {
      followed = true;
      ok(res, urlset(`${base}/a`));
    };
    const artifact = await collect();
    expect(artifact.documents[0]).toMatchObject({
      outcome: 'redirect',
      status: 301,
      redirectLocation: `${base}/new.xml`,
    });
    expect(followed).toBe(false);
  });

  it('reports a redirect to an internal address as data, never fetching it', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/old.xml`);
    routes['/old.xml'] = res => {
      res.writeHead(302, {Location: 'http://169.254.169.254/latest/meta-data/'});
      res.end();
    };
    const artifact = await collect();
    expect(artifact.documents[0].outcome).toBe('redirect');
    expect(artifact.documents[0].redirectLocation).toBe('http://169.254.169.254/latest/meta-data/');
  });

  it('records a slow sitemap as a network-error after the timeout, and still returns the rest', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/slow.xml\nSitemap: ${base}/fast.xml`);
    routes['/slow.xml'] = () => {
      /* never responds */
    };
    routes['/fast.xml'] = res => ok(res, urlset(`${base}/a`));
    const artifact = await collect({timeoutMs: 300});
    expect(artifact.documents[0]).toMatchObject({outcome: 'network-error'});
    expect(artifact.documents[0].errorMessage).toMatch(/timed out/);
    expect(artifact.documents[1].outcome).toBe('ok');
  }, 10000);

  it('records a trickling server as a network-error at the total deadline', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/trickle.xml`);
    routes['/trickle.xml'] = res => {
      res.writeHead(200);
      const timer = setInterval(() => res.write(' '), 50);
      res.on('close', () => clearInterval(timer));
    };
    const artifact = await collect({timeoutMs: 400});
    expect(artifact.documents[0].outcome).toBe('network-error');
    expect(artifact.documents[0].errorMessage).toMatch(/timed out/);
  }, 10000);

  it('records a body over the byte cap as a network-error rather than buffering it', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/big.xml`);
    routes['/big.xml'] = res => ok(res, Buffer.alloc(5000, 0x20));
    const artifact = await collect({maxBytes: 1000});
    expect(artifact.documents[0].outcome).toBe('network-error');
    expect(artifact.documents[0].errorMessage).toMatch(/exceeded 1000 bytes/);
  });

  it('a real gzip bomb over the wire is small on the wire and does not expand past the cap', async () => {
    // 60 MiB of zeros gzips to well under 100 KB: tiny on the wire, huge if inflated. The real
    // 50 MiB + 1 output cap must stop it, flagged as exceeded rather than parsed.
    const bomb = zlib.gzipSync(Buffer.alloc(60 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(200 * 1024);
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/bomb.xml.gz`);
    routes['/bomb.xml.gz'] = res => ok(res, bomb);
    const artifact = await collect();
    expect(artifact.documents[0]).toMatchObject({
      outcome: 'ok',
      gzip: true,
      exceededUncompressedLimit: true,
      kind: null,
      locs: [],
    });
  }, 30000);

  it('records a corrupt gzip stream as a decompression-error', async () => {
    routes['/robots.txt'] = res => ok(res, `Sitemap: ${base}/bad.xml.gz`);
    routes['/bad.xml.gz'] = res =>
      ok(res, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const artifact = await collect();
    expect(artifact.documents[0].outcome).toBe('decompression-error');
  });

  it('reports "none" when robots.txt exists without a Sitemap line and /sitemap.xml is 404', async () => {
    routes['/robots.txt'] = res => ok(res, 'User-agent: *\nDisallow:');
    const artifact = await collect();
    expect(artifact).toMatchObject({discovery: 'none', documents: []});
  });
});

describe('collectSitemapDocuments — default fetcher, private-network opt-in, real local server', () => {
  const original = process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
  /** @type {http.Server} */
  let server;
  let base = '';

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/robots.txt') {
        res.writeHead(200);
        res.end(`Sitemap: ${base}/sitemap.xml`);
      } else if (req.url === '/sitemap.xml') {
        res.writeHead(200);
        res.end(urlset(`${base}/a`));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (original === undefined) delete process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
    else process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK = original;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  it('finds and parses a sitemap served on localhost when the opt-in is set', async () => {
    process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK = '1';
    const artifact = await collectSitemapDocuments({finalDisplayedUrl: `${base}/page`});
    expect(artifact.discovery).toBe('robots-txt');
    expect(artifact.unavailableReason).toBeNull();
    expect(artifact.documents[0]).toMatchObject({
      outcome: 'ok',
      kind: 'urlset',
      locs: [`${base}/a`],
    });
  });

  it('reports unavailable, with the reason and the setting, when the opt-in is not set', async () => {
    delete process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
    const artifact = await collectSitemapDocuments({finalDisplayedUrl: `${base}/page`});
    expect(artifact.discovery).toBe('unavailable');
    expect(artifact.documents).toEqual([]);
    expect(artifact.unavailableReason).toMatch(
      /private\/reserved.*LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/
    );
  });

  it('still refuses a sitemap that points at the cloud metadata address, opted in', async () => {
    process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK = '1';
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      res.writeHead(200);
      res.end(req.url === '/robots.txt' ? 'Sitemap: http://169.254.169.254/latest/meta-data/' : '');
    });
    const artifact = await collectSitemapDocuments({finalDisplayedUrl: `${base}/page`});
    expect(artifact.documents[0].outcome).toBe('network-error');
    expect(artifact.documents[0].errorMessage).toMatch(/private\/reserved/);
    expect(artifact.documents[0].errorMessage).not.toContain('LHCI_SEO_ALLOW_PRIVATE_NETWORK');
  });
});
