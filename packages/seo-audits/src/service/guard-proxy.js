/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * A forward proxy on 127.0.0.1 that Chrome is forced through while the service audits a page. The host allow-list and
 * `safe-fetch` guard the requests Node makes; they cannot guard Chrome, which resolves names and follows redirects
 * itself. Without this, an allowed hostname that resolves (or is redirected, or whose subresources point) to an internal
 * address would be fetched by Chrome and its content audited.
 *
 * With `--proxy-server` Chrome sends every request here and leaves name resolution to us, so each connection, whether it
 * is the page, a redirect hop, an image or a script, is resolved by *this* code, refused if any address is private or
 * reserved, and connected to the very address that was checked (the `lookup` option; no second lookup, so no DNS
 * rebinding window). It never honours `LHCI_SEO_ALLOW_PRIVATE_NETWORK`: the service has no reason to audit private hosts.
 *
 * HTTPS goes through as an opaque CONNECT tunnel (nothing is decrypted). Only a few ports are allowed, so the proxy
 * cannot be pointed at mail or database ports on a public host. `blocked` lists what was refused for its address (worth
 * reporting); `denied` lists refused ports and schemes (mostly Chrome's own background traffic). The proxy lives for one run and listens on loopback only.
 */

import http from 'http';
import net from 'net';
import {publicOnlyLookup, isPrivateOrReservedIp} from '../lib/safe-fetch.js';

const DEFAULT_PORTS = [80, 443, 8080, 8443];
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const MAX_BLOCKED_RECORDED = 50;

/**
 * @param {string} host
 * @return {string} The host without the brackets of an IPv6 literal.
 */
function bare(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * @param {string} text `host:port` or `[v6]:port`
 * @return {{host: string, port: number} | null}
 */
function parseHostPort(text) {
  const match = /^(\[[0-9a-fA-F:.]+\]|[^:\s/]+):(\d{1,5})$/.exec(text || '');
  if (!match) return null;
  return {host: bare(match[1]), port: Number(match[2])};
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @return {Record<string, string | string[] | undefined>}
 */
function forwardable(headers) {
  /** @type {Record<string, string | string[] | undefined>} */
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/**
 * Resolves a host the way the proxy will, to fail early with a clear message.
 * @param {string} hostname
 * @param {typeof publicOnlyLookup} [lookup]
 * @return {Promise<void>} Rejects when the host resolves to (or is) a private or reserved address.
 */
function assertPublicHost(hostname, lookup = publicOnlyLookup) {
  return new Promise((resolve, reject) => {
    lookup(bare(hostname), {all: true}, err => (err ? reject(err) : resolve()));
  });
}

/**
 * @param {{
 *   lookup?: typeof publicOnlyLookup, allowedPorts?: number[], maxConnections?: number, idleMs?: number,
 * }} [options] `lookup` is for tests only; the default refuses every private or reserved address.
 * @return {Promise<{port: number, url: string, blocked: Array<{host: string, reason: string}>, denied: Array<{host: string, reason: string}>, close: () => Promise<void>}>}
 */
function createGuardProxy({
  lookup = publicOnlyLookup,
  allowedPorts = DEFAULT_PORTS,
  maxConnections = 256,
  idleMs = 60_000,
} = {}) {
  const ports = new Set(allowedPorts);
  /** @type {Array<{host: string, reason: string}>} */
  const blocked = [];
  /** @type {Set<import('net').Socket>} */
  const sockets = new Set();

  /** @type {Array<{host: string, reason: string}>} Port or scheme refusals: mostly Chrome's own background traffic. */
  const denied = [];
  /** @param {string} host @param {string} reason */
  const block = (host, reason) => {
    if (blocked.length < MAX_BLOCKED_RECORDED) blocked.push({host, reason});
  };
  /** @param {string} host @param {string} reason */
  const deny = (host, reason) => {
    if (denied.length < MAX_BLOCKED_RECORDED) denied.push({host, reason});
  };
  /** @param {import('net').Socket} socket */
  const track = socket => {
    if (sockets.has(socket)) return; // a kept-alive socket carries many requests: listen once
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };
  /** @param {string} host @return {string | null} Why the host is refused before any lookup, or null. */
  const literalRefusal = host =>
    net.isIP(host) && lookup === publicOnlyLookup && isPrivateOrReservedIp(host)
      ? 'a private or reserved address'
      : null;
  /** @param {Error} err */
  const isRefusal = err => /^refusing to connect/.test(err.message);

  const server = http.createServer((clientReq, clientRes) => {
    track(clientReq.socket);
    /** @type {URL} */
    let url;
    try {
      url = new URL(clientReq.url || '');
    } catch (_) {
      clientRes.writeHead(400).end();
      return;
    }
    const port = Number(url.port || 80);
    const host = bare(url.hostname);
    if (url.protocol !== 'http:' || !ports.has(port)) {
      deny(host, `not allowed (${url.protocol}//:${port})`);
      clientRes.writeHead(403).end();
      return;
    }
    const refusal = literalRefusal(host);
    if (refusal) {
      block(host, refusal);
      clientRes.writeHead(403).end();
      return;
    }
    // `lookup` is a supported request option that this repo's older Node typings do not list.
    const requestOptions = /** @type {any} */ ({
      host,
      port,
      path: `${url.pathname}${url.search}`,
      method: clientReq.method,
      headers: forwardable(clientReq.headers),
      lookup,
      agent: false,
      timeout: idleMs,
    });
    const upstream = http.request(requestOptions, upRes => {
      clientRes.writeHead(upRes.statusCode || 502, forwardable(upRes.headers));
      upRes.pipe(clientRes);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timed out')));
    upstream.on('error', err => {
      if (isRefusal(err)) block(host, err.message);
      if (!clientRes.headersSent) clientRes.writeHead(isRefusal(err) ? 403 : 502).end();
      else clientRes.destroy();
    });
    clientRes.on('close', () => upstream.destroy());
    clientReq.pipe(upstream);
  });
  server.maxConnections = maxConnections;

  server.on('connect', (req, clientSocket, head) => {
    track(clientSocket);
    clientSocket.on('error', () => clientSocket.destroy());
    const target = parseHostPort(req.url || '');
    if (!target || !ports.has(target.port)) {
      deny(target ? target.host : String(req.url).slice(0, 80), 'port not allowed');
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const refusal = literalRefusal(target.host);
    if (refusal) {
      block(target.host, refusal);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect({
      host: target.host,
      port: target.port,
      lookup: /** @type {any} */ (lookup),
    });
    track(upstream);
    upstream.setTimeout(idleMs, () => upstream.destroy());
    clientSocket.setTimeout(idleMs, () => clientSocket.destroy());
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', err => {
      if (isRefusal(err)) block(target.host, err.message);
      clientSocket.end(`HTTP/1.1 ${isRefusal(err) ? 403 : 502} Blocked\r\n\r\n`);
      clientSocket.destroy();
    });
    clientSocket.on('close', () => upstream.destroy());
    upstream.on('close', () => clientSocket.destroy());
  });
  server.on('clientError', (_err, socket) => socket.destroy());

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('net').AddressInfo} */ (server.address());
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        blocked,
        denied,
        close: () =>
          new Promise(done => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

export {createGuardProxy, assertPublicHost, parseHostPort, DEFAULT_PORTS};
