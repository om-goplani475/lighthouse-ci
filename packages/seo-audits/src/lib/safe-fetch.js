/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The first outbound network fetch capability this package ever needed (originally built for
 * audits/manifest-icons.js, to fetch a page's web-app-manifest JSON; audits/
 * open-graph-image-reachable.js reuses the same SSRF-protected primitives via `safeFetchStatus`
 * to confirm an `og:image` URL resolves, without downloading the image itself). Every other
 * audit/gatherer only reads data the page already loaded — this deliberately fetches a *second*
 * URL discovered on the page, which is exactly the attack surface
 * `.ai-agents/prompts/security-checklist.md` exists for: SSRF via an attacker-controlled page
 * pointing its manifest/image link at an internal service, cloud metadata endpoint, or arbitrary
 * scheme.
 *
 * Protections, each directly required by the security checklist:
 * - Scheme allowlist: only http/https.
 * - Private/reserved IP blocking, after DNS resolution (not just hostname string matching) —
 *   RFC 1918, loopback, link-local (which covers the 169.254.169.254 cloud metadata address,
 *   also checked implicitly since it falls in that /16), carrier-grade NAT, and IPv6 equivalents.
 * - DNS-rebinding resistant: the IP address our own resolution validates is the *exact* address
 *   Node's http/https client connects to (via the `lookup` option), not a hostname Node would
 *   re-resolve itself — otherwise an attacker could pass validation with a safe IP on first
 *   lookup and rebind to a private IP by the time the actual TCP connection happens.
 * - No redirect following — a redirect to an internal URL would bypass the origin check
 *   entirely; simplest safe answer is to not follow any.
 * - Bounded: one request, a timeout, and a response-size cap (no unbounded download).
 *
 * Not an exhaustive, hardened-for-adversarial-multi-tenant-SaaS implementation — this is a local
 * SEO-auditing CLI tool run against pages the developer running it already chose to audit, not a
 * public-facing service processing arbitrary third-party requests. It covers every item the
 * security checklist explicitly calls for.
 */

import http from 'http';
import https from 'https';
import net from 'net';
import dns from 'dns';

/**
 * @param {string} ip
 * @return {number}
 */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0) >>> 0;
}

// Each pair is [rangeStart, rangeEnd], inclusive. Covers RFC 1918 private ranges, loopback,
// link-local (includes the 169.254.169.254 cloud metadata address), carrier-grade NAT, and the
// remaining IANA special-purpose/reserved/multicast ranges.
const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', '0.255.255.255'],
  ['10.0.0.0', '10.255.255.255'],
  ['100.64.0.0', '100.127.255.255'],
  ['127.0.0.0', '127.255.255.255'],
  ['169.254.0.0', '169.254.255.255'],
  ['172.16.0.0', '172.31.255.255'],
  ['192.0.0.0', '192.0.0.255'],
  ['192.0.2.0', '192.0.2.255'],
  ['192.168.0.0', '192.168.255.255'],
  ['198.18.0.0', '198.19.255.255'],
  ['198.51.100.0', '198.51.100.255'],
  ['203.0.113.0', '203.0.113.255'],
  ['224.0.0.0', '255.255.255.255'],
].map(([start, end]) => [ipv4ToInt(start), ipv4ToInt(end)]);

/**
 * @param {string} ip
 * @return {boolean}
 */
function isPrivateIPv4(ip) {
  const int = ipv4ToInt(ip);
  return IPV4_BLOCKED_RANGES.some(([start, end]) => int >= start && int <= end);
}

/**
 * @param {string} ip
 * @return {boolean}
 */
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  // fe80::/10 (link-local)
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  // fc00::/7 (unique local)
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4 address too.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * @param {string} ip
 * @return {boolean}
 */
function isPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // Unrecognized format — refuse rather than guess.
}

/**
 * A `dns.lookup`-compatible function (same signature Node's `http`/`https` `lookup` request
 * option expects) that resolves normally but throws if every candidate address is
 * private/reserved. Passing this as the `lookup` option is what makes the validated address the
 * one actually connected to — see the module doc's DNS-rebinding note.
 *
 * Must honor `options.all` and reply in kind (a single `(address, family)` tuple, or an array of
 * `{address, family}` objects), exactly like real `dns.lookup` does — not always the single-tuple
 * shape. Node's own `net.connect` requests `{all: true}` whenever Happy Eyeballs
 * (`net.getDefaultAutoSelectFamily()`, `true` by default since Node 20) is active, which is the
 * normal case for any `http.request`/`https.request` to a real hostname, not just an edge case.
 * Ignoring that and always replying single-tuple isn't a safe fail-closed default — Node's
 * `emitLookup` throws `Invalid IP address: undefined` trying to read `addresses[0]` off what it
 * thinks is an array, breaking every real fetch to a non-literal-IP hostname outright (confirmed:
 * this broke `safeFetchStatus` against a real external URL during live QA for
 * `open-graph-image-reachable`, and would equally have broken `safeFetchJson`/`manifest-icons`
 * for any manifest on a normal domain — this was a real latent bug, not just a new one).
 * @param {string} hostname
 * @param {{all?: boolean}} options
 * @param {(err: Error | null, address?: string | Array<{address: string, family: number}>, family?: number) => void} callback
 */
function safeLookup(hostname, options, callback) {
  const wantsAll = Boolean(options && options.all);

  // IPv4/IPv6 literal hostnames skip DNS resolution entirely in Node's dns.lookup — handle them
  // directly so a literal private IP in the URL can't bypass this check.
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      callback(new Error(`refusing to connect to "${hostname}": a private/reserved IP address`));
      return;
    }
    const family = net.isIPv6(hostname) ? 6 : 4;
    if (wantsAll) {
      callback(null, [{address: hostname, family}]);
    } else {
      callback(null, hostname, family);
    }
    return;
  }

  dns.lookup(hostname, {all: true, verbatim: true}, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }
    const blocked = addresses.find(a => isPrivateOrReservedIp(a.address));
    if (blocked) {
      callback(
        new Error(
          `refusing to connect to "${hostname}": resolves to a private/reserved address ` +
            `(${blocked.address})`
        )
      );
      return;
    }
    if (addresses.length === 0) {
      callback(new Error(`"${hostname}" did not resolve to any address`));
      return;
    }
    if (wantsAll) {
      callback(null, addresses);
      return;
    }
    const {address, family} = addresses[0];
    callback(null, address, family);
  });
}

/**
 * The actual request mechanics (timeout, size cap, JSON parsing), parameterized by which `lookup`
 * function to use. Not exported as public API — exists so tests can exercise this logic against a
 * real local server with a permissive test-only lookup, without the public `safeFetchJson`
 * function ever accepting a way to override `safeLookup` itself (there is no parameter for it —
 * structurally impossible for a real caller to weaken the SSRF protection, not just documented as
 * something not to do).
 * @param {string} urlString
 * @param {typeof safeLookup} lookup
 * @param {{timeoutMs?: number, maxBytes?: number}} [options]
 * @return {Promise<unknown>}
 */
function fetchJsonWithLookup(urlString, lookup, {timeoutMs = 5000, maxBytes = 1_000_000} = {}) {
  return new Promise((resolve, reject) => {
    /** @type {URL} */
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`"${urlString}" is not a valid URL`));
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error(`refusing to fetch "${urlString}": scheme must be http or https`));
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        // @ts-expect-error - `lookup` is a real, working option here (it's threaded through to
        // net.connect internally, confirmed by this file's own passing tests, including the
        // DNS-rebinding-resistance behavior it exists for) — just not declared on http.d.ts's
        // RequestOptions in this monorepo's pinned `@types/node@11.13.2` (2019-era, far behind
        // the Node 24 runtime this actually executes on). It is declared on net.d.ts's connect
        // options, which is what http.request ultimately passes options through to.
        lookup,
        timeout: timeoutMs,
        headers: {Accept: 'application/manifest+json, application/json'},
      },
      res => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`fetch of "${urlString}" returned HTTP ${status}`));
          return;
        }

        let total = 0;
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', chunk => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error(`response for "${urlString}" exceeded ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (err) {
            reject(new Error(`response for "${urlString}" was not valid JSON: ${err.message}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`fetch of "${urlString}" timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Same connection setup as `fetchJsonWithLookup` (URL/scheme validation, `lookup` wiring) but
 * resolves as soon as response headers arrive and never reads the body — used when only the
 * status code matters (e.g. confirming an `og:image` URL resolves), not the response content, so
 * there's nothing to download or size-cap. Not exported as public API, same reasoning as
 * `fetchJsonWithLookup` — exists so tests can exercise this against a real local server with a
 * permissive test-only lookup.
 * @param {string} urlString
 * @param {typeof safeLookup} lookup
 * @param {{timeoutMs?: number}} [options]
 * @return {Promise<{status: number}>}
 */
function statusWithLookup(urlString, lookup, {timeoutMs = 5000} = {}) {
  return new Promise((resolve, reject) => {
    /** @type {URL} */
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`"${urlString}" is not a valid URL`));
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error(`refusing to fetch "${urlString}": scheme must be http or https`));
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      // @ts-expect-error - see fetchJsonWithLookup's identical comment on `lookup`.
      {method: 'GET', lookup, timeout: timeoutMs},
      res => {
        const status = res.statusCode ?? 0;
        res.destroy();
        resolve({status});
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`fetch of "${urlString}" timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetches raw response bytes, for callers (sitemaps) that need the body itself and the status of
 * *any* response — unlike `fetchJsonWithLookup` this resolves non-2xx responses (including a 3xx
 * with its `Location`, never followed) instead of rejecting. Same connection setup, scheme check,
 * and `lookup` wiring as its siblings; not exported as public API for the same reason.
 *
 * `timeoutMs` is a *total* wall-clock deadline for the whole request, not only a socket idle
 * timeout like its siblings: a server trickling one byte every few seconds never trips an idle
 * timeout, and with a multi-MiB byte cap could otherwise hold a request open almost indefinitely.
 * @param {string} urlString
 * @param {typeof safeLookup} lookup
 * @param {{timeoutMs?: number, maxBytes?: number}} [options]
 * @return {Promise<{status: number, redirectLocation: string | null, body: Buffer}>}
 */
function fetchBytesWithLookup(
  urlString,
  lookup,
  {timeoutMs = 10_000, maxBytes = 15 * 1024 * 1024} = {}
) {
  return new Promise((resolve, reject) => {
    /** @type {URL} */
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`"${urlString}" is not a valid URL`));
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error(`refusing to fetch "${urlString}": scheme must be http or https`));
      return;
    }

    // Every exit goes through `fail`/`succeed`, which settle exactly once and always clear the
    // deadline. Rejecting explicitly (rather than relying on req.destroy(err) to surface an error)
    // matters: once a response has started, destroying the request surfaces on the response, and
    // a stray 'end' would otherwise resolve with a truncated body that looks like a real one.
    let settled = false;
    /** @param {Error} err */
    const fail = err => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req.destroy();
      reject(err);
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        // @ts-expect-error - see fetchJsonWithLookup's identical comment on `lookup`.
        lookup,
        headers: {Accept: 'application/xml, text/xml, application/gzip, */*'},
      },
      res => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;

        let total = 0;
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', chunk => {
          total += chunk.length;
          if (total > maxBytes) {
            fail(new Error(`response for "${urlString}" exceeded ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          // `complete` is a real IncomingMessage property (false when the response was aborted
          // before its final chunk), just missing from this monorepo's pinned, 2019-era @types/node.
          if (!(/** @type {{complete?: boolean}} */ (res).complete)) {
            fail(new Error(`response for "${urlString}" ended before it was complete`));
            return;
          }
          settled = true;
          clearTimeout(deadline);
          resolve({
            status,
            redirectLocation: typeof location === 'string' ? location : null,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    const deadline = setTimeout(() => {
      fail(new Error(`fetch of "${urlString}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on('error', fail);
    req.end();
  });
}

/**
 * Fetches a URL and resolves with just its HTTP status code, with the same SSRF/DoS protections
 * as `safeFetchJson` — the response body is never read or downloaded.
 * @param {string} urlString
 * @param {{timeoutMs?: number}} [options]
 * @return {Promise<{status: number}>}
 */
function safeFetchStatus(urlString, options) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new Error(`"${urlString}" is not a valid URL`));
  }
  if (net.isIP(url.hostname) && isPrivateOrReservedIp(url.hostname)) {
    return Promise.reject(
      new Error(`refusing to fetch "${urlString}": a private/reserved IP address (${url.hostname})`)
    );
  }

  return statusWithLookup(urlString, safeLookup, options);
}

/**
 * Fetches a URL and parses the response as JSON, with the SSRF/DoS protections documented above.
 * @param {string} urlString
 * @param {{timeoutMs?: number, maxBytes?: number}} [options]
 * @return {Promise<unknown>}
 */
function safeFetchJson(urlString, options) {
  // Node's http/https client skips the custom `lookup` option entirely when the URL's hostname
  // is already a literal IP address — no DNS resolution is needed, so `safeLookup` never runs.
  // Confirmed empirically (a request to a literal 127.0.0.1 URL reached ECONNREFUSED instead of
  // being blocked) before shipping this, not assumed. This is the simplest possible SSRF bypass
  // (just put the raw IP in the URL) and `safeLookup` alone does not catch it — validate the
  // literal-IP case explicitly, before `lookup` is ever in play.
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new Error(`"${urlString}" is not a valid URL`));
  }
  if (net.isIP(url.hostname) && isPrivateOrReservedIp(url.hostname)) {
    return Promise.reject(
      new Error(`refusing to fetch "${urlString}": a private/reserved IP address (${url.hostname})`)
    );
  }

  return fetchJsonWithLookup(urlString, safeLookup, options);
}

/**
 * Fetches a URL's raw bytes, with the same SSRF/DoS protections as `safeFetchJson`: scheme
 * allowlist, private/reserved-IP blocking (literal and post-DNS), DNS-rebinding-resistant lookup,
 * no redirects followed, a total timeout, and a byte cap. Non-2xx responses are *returned*, not
 * thrown, so the caller can record the status (and a redirect's `Location`).
 * @param {string} urlString
 * @param {{timeoutMs?: number, maxBytes?: number}} [options]
 * @return {Promise<{status: number, redirectLocation: string | null, body: Buffer}>}
 */
function safeFetchBytes(urlString, options) {
  // Same literal-IP bypass as safeFetchJson: Node skips `lookup` for a literal-IP hostname, so it
  // must be validated explicitly before the request is made.
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new Error(`"${urlString}" is not a valid URL`));
  }
  if (net.isIP(url.hostname) && isPrivateOrReservedIp(url.hostname)) {
    return Promise.reject(
      new Error(`refusing to fetch "${urlString}": a private/reserved IP address (${url.hostname})`)
    );
  }

  return fetchBytesWithLookup(urlString, safeLookup, options);
}

export {
  safeFetchBytes,
  safeFetchJson,
  safeFetchStatus,
  isPrivateOrReservedIp,
  safeLookup,
  fetchJsonWithLookup,
  statusWithLookup,
  fetchBytesWithLookup,
};
