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

// The subset of the blocked ranges the private-network opt-in may unblock (see
// isPermittedPrivateAddress): loopback and RFC 1918 only.
const PERMITTED_PRIVATE_IPV4_RANGES = [
  ['10.0.0.0', '10.255.255.255'],
  ['127.0.0.0', '127.255.255.255'],
  ['172.16.0.0', '172.31.255.255'],
  ['192.168.0.0', '192.168.255.255'],
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
 * Expands an IPv6 address (as `net.isIPv6` accepts it: `::` compression, an optional trailing
 * dotted IPv4) into its 16 bytes.
 * @param {string} ip
 * @return {number[] | null} null if it can't be parsed (the caller then refuses it).
 */
function ipv6ToBytes(ip) {
  let text = ip.toLowerCase();
  // A trailing dotted IPv4 (::ffff:1.2.3.4) is two 16-bit groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

/**
 * @param {number[]} bytes Four bytes of an embedded IPv4 address.
 * @return {boolean}
 */
function isPrivateEmbeddedIPv4(bytes) {
  return isPrivateIPv4(bytes.join('.'));
}

/**
 * Works on the address's bytes, not its text: the same address has many spellings, and the URL
 * parser normalizes `[::ffff:169.254.169.254]` to the hex form `::ffff:a9fe:a9fe`, which a
 * text-only pattern for the dotted form would miss.
 * @param {string} ip
 * @return {boolean}
 */
function isPrivateIPv6(ip) {
  const b = ipv6ToBytes(ip);
  if (!b) return true; // Unparseable: refuse rather than guess.

  const first80Zero = b.slice(0, 10).every(x => x === 0);
  // ::/96 — the unspecified and loopback addresses, plus the deprecated IPv4-compatible range;
  // none is a legitimate public destination.
  if (first80Zero && b[10] === 0 && b[11] === 0) return true;
  // ::ffff:0:0/96 — IPv4-mapped: judge the embedded IPv4 address.
  if (first80Zero && b[10] === 0xff && b[11] === 0xff) return isPrivateEmbeddedIPv4(b.slice(12));
  // 64:ff9b::/96 — NAT64: judge the embedded IPv4 address.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    if (b.slice(4, 12).every(x => x === 0)) return isPrivateEmbeddedIPv4(b.slice(12));
  }
  // 2002::/16 — 6to4: the embedded IPv4 address is bytes 2-5.
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateEmbeddedIPv4(b.slice(2, 6));
  // fe80::/10 (link-local)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  // fc00::/7 (unique local)
  if ((b[0] & 0xfe) === 0xfc) return true;
  // ff00::/8 (multicast)
  if (b[0] === 0xff) return true;
  // 2001:db8::/32 (documentation) and 100::/64 (discard-only)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  if (b[0] === 0x01 && b.slice(1, 8).every(x => x === 0)) return true;
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
 * Opt-in for running the audits against your own private hosts (a site served on localhost inside a
 * CI job, or a staging host on a private network). Off unless the *process environment* sets it, so
 * nothing on an audited page can turn it on; read on every request, never cached.
 */
const ALLOW_PRIVATE_NETWORK_ENV = 'LHCI_SEO_ALLOW_PRIVATE_NETWORK';

/**
 * @return {boolean}
 */
function privateNetworkAllowed() {
  const value = process.env[ALLOW_PRIVATE_NETWORK_ENV];
  return value === '1' || value === 'true';
}

/**
 * The only addresses the opt-in can unblock: loopback, RFC 1918, and IPv6 unique-local, including
 * IPv4-mapped spellings of the IPv4 ones. Deliberately *not* link-local (169.254.0.0/16, which is
 * the cloud metadata address), 0.0.0.0/8, carrier-grade NAT, multicast or any other reserved range:
 * those stay blocked even with the opt-in on, because they are what a hostile page would aim at.
 * @param {string} ip
 * @return {boolean}
 */
function isPermittedPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const int = ipv4ToInt(ip);
    return PERMITTED_PRIVATE_IPV4_RANGES.some(([start, end]) => int >= start && int <= end);
  }
  if (net.isIPv6(ip)) {
    const b = ipv6ToBytes(ip);
    if (!b) return false;
    const first80Zero = b.slice(0, 10).every(x => x === 0);
    // ::1 (loopback)
    if (first80Zero && b[10] === 0 && b[11] === 0) {
      return b.slice(12, 15).every(x => x === 0) && b[15] === 1;
    }
    // IPv4-mapped: judge the embedded IPv4 address by the IPv4 rules.
    if (first80Zero && b[10] === 0xff && b[11] === 0xff) {
      return isPermittedPrivateAddress(b.slice(12).join('.'));
    }
    // fc00::/7 (unique local)
    return (b[0] & 0xfe) === 0xfc;
  }
  return false;
}

/**
 * Whether a connection to this address must be refused: any private/reserved address, unless the
 * private-network opt-in is on and the address is one of the few it may unblock. This is the one
 * decision point every request path goes through.
 * @param {string} ip
 * @return {boolean}
 */
function isBlockedAddress(ip) {
  if (!isPrivateOrReservedIp(ip)) return false;
  return !(privateNetworkAllowed() && isPermittedPrivateAddress(ip));
}

/**
 * A hint appended to a refusal, only when the opt-in would actually have allowed the address, so an
 * error for a metadata-address attempt does not advertise a setting that could not help.
 * @param {string} ip
 * @return {string}
 */
function optInHint(ip) {
  return isPermittedPrivateAddress(ip)
    ? ` To audit your own private or staging host, set ${ALLOW_PRIVATE_NETWORK_ENV}=1.`
    : '';
}

/**
 * The IP address a URL's hostname literally is, or null if it is a DNS name. `new URL()` keeps the
 * brackets on an IPv6 literal (`[::1]`), and `net.isIP('[::1]')` is 0 — so without stripping them
 * every IPv6 literal was treated as a DNS name, skipped this check, and (because Node also skips
 * the `lookup` option for literals) reached the network unvalidated.
 * @param {URL} url
 * @return {string | null}
 */
function literalIpOf(url) {
  const host = url.hostname;
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return net.isIP(bare) ? bare : null;
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
 * Built by `createSafeLookup` so there is one implementation: `safeLookup` (the private-network opt-in applies) and
 * `publicOnlyLookup` (it never does, used for links to other sites).
 * @param {(ip: string) => boolean} isBlocked The one decision about an address.
 * @param {(ip: string) => string} hint Text appended to a refusal.
 * @return {(hostname: string, options: {all?: boolean}, callback: (err: Error | null, address?: string | Array<{address: string, family: number}>, family?: number) => void) => void}
 */
function createSafeLookup(isBlocked, hint) {
  return function lookup(hostname, options, callback) {
    const wantsAll = Boolean(options && options.all);

    // IPv4/IPv6 literal hostnames skip DNS resolution entirely in Node's dns.lookup — handle them
    // directly so a literal private IP in the URL can't bypass this check.
    if (net.isIP(hostname)) {
      if (isBlocked(hostname)) {
        callback(
          new Error(
            `refusing to connect to "${hostname}": a private/reserved IP address.${hint(hostname)}`
          )
        );
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
      const blocked = addresses.find(a => isBlocked(a.address));
      if (blocked) {
        callback(
          new Error(
            `refusing to connect to "${hostname}": resolves to a private/reserved address ` +
              `(${blocked.address}).${hint(blocked.address)}`
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
  };
}

const safeLookup = createSafeLookup(isBlockedAddress, optInHint);

/**
 * Like `safeLookup` but refusing every private or reserved address whatever the environment says: for requests to
 * other people's sites, which must never be steerable at a private address (not even with the private-network
 * opt-in on, which is for the audited site only).
 */
const publicOnlyLookup = createSafeLookup(isPrivateOrReservedIp, () => '');

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
 * @return {Promise<{status: number, redirectLocation?: string}>}
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
        const location = res.headers.location;
        res.destroy();
        // `redirectLocation` only appears for a response that has one, so a plain `{status}` result
        // (every existing caller and test) is unchanged.
        resolve(typeof location === 'string' ? {status, redirectLocation: location} : {status});
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`fetch of "${urlString}" timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

const MAX_USER_AGENT_LENGTH = 200;

/**
 * @param {unknown} value
 * @return {value is string}
 */
function isValidUserAgent(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_USER_AGENT_LENGTH &&
    /^[\x20-\x7e]+$/.test(value)
  );
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
 * `userAgent` (optional) is sent as the `User-Agent` header, validated exactly as in `fetchPrefixWithLookup`
 * (printable ASCII, 1 to 200 characters, otherwise rejected before any lookup or connection). Absent, no
 * `User-Agent` is sent, exactly as before.
 * @param {string} urlString
 * @param {typeof safeLookup} lookup
 * @param {{timeoutMs?: number, maxBytes?: number, userAgent?: string}} [options]
 * @return {Promise<{status: number, redirectLocation: string | null, body: Buffer}>}
 */
function fetchBytesWithLookup(
  urlString,
  lookup,
  {timeoutMs = 10_000, maxBytes = 15 * 1024 * 1024, userAgent} = {}
) {
  return new Promise((resolve, reject) => {
    if (userAgent !== undefined && !isValidUserAgent(userAgent)) {
      reject(new Error('refusing to fetch: userAgent must be 1 to 200 printable ASCII characters'));
      return;
    }
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
        headers: {
          Accept: 'application/xml, text/xml, application/gzip, */*',
          ...(userAgent === undefined ? {} : {'User-Agent': userAgent}),
        },
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

const PREFIX_HEADER_ALLOWLIST = ['x-robots-tag', 'content-type', 'content-encoding', 'location'];
const PREFIX_MAX_HEADER_VALUES = 10;
const PREFIX_MAX_HEADER_LENGTH = 1000;

/**
 * @typedef {{
 *   'x-robots-tag': string[],
 *   'content-type': string[],
 *   'content-encoding': string[],
 *   location: string[],
 * }} PrefixHeaders
 * @typedef {{
 *   status: number,
 *   redirectLocation: string | null,
 *   headers: PrefixHeaders,
 *   body: Buffer,
 *   bodyRead: 'html' | 'skipped-status' | 'skipped-not-html' | 'skipped-compressed',
 *   truncated: boolean,
 * }} PrefixResult
 */

/**
 * The allowlisted response headers, every occurrence of each. Taken from `rawHeaders`, not
 * `res.headers`: Node merges repeated headers into one comma-joined string there, and for
 * `X-Robots-Tag` the boundary between two occurrences matters (`noindex` and `googlebot: nofollow`
 * are two headers, not one list).
 * @param {string[]} rawHeaders
 * @return {PrefixHeaders}
 */
function collectPrefixHeaders(rawHeaders) {
  /** @type {PrefixHeaders} */
  const headers = {'x-robots-tag': [], 'content-type': [], 'content-encoding': [], location: []};
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (!PREFIX_HEADER_ALLOWLIST.includes(name)) continue;
    const list = headers[/** @type {keyof PrefixHeaders} */ (name)];
    if (list.length < PREFIX_MAX_HEADER_VALUES) {
      list.push(rawHeaders[i + 1].slice(0, PREFIX_MAX_HEADER_LENGTH));
    }
  }
  return headers;
}

/**
 * Fetches a URL's headers and, only for a 2xx HTML response, the first `maxBytes` of its body. Built
 * for reading a page's `<head>`: it never downloads a whole page, and never reads a body it cannot
 * use (a PDF, an error page, or a compressed response, since Node does not decompress and the prefix
 * of a gzip stream is not HTML; `Accept-Encoding: identity` is sent to avoid that). Skipped bodies
 * still return their headers, so an `X-Robots-Tag` on a PDF is seen.
 *
 * Reaching `maxBytes` (or a body that stalls after its headers until the deadline) *resolves* with
 * `truncated: true`, because a prefix is what was asked for; a failure before any headers arrive
 * rejects. `timeoutMs` is a total wall-clock deadline, as in `fetchBytesWithLookup`. Same
 * URL/scheme checks and `lookup` wiring as its siblings; not exported as public API for the same
 * reason.
 * `userAgent` (optional) is sent as the `User-Agent` header, so a crawler can identify itself. It must be
 * printable ASCII, 1 to 200 characters; anything else (control characters including CR/LF/NUL,
 * non-ASCII, empty, too long, not a string) rejects before any DNS lookup or connection, because a header
 * value is the classic place to smuggle a second header or request. Absent, no `User-Agent` is sent,
 * exactly as before.
 * @param {string} urlString
 * @param {typeof safeLookup} lookup
 * @param {{timeoutMs?: number, maxBytes?: number, userAgent?: string}} [options]
 * @return {Promise<PrefixResult>}
 */
function fetchPrefixWithLookup(
  urlString,
  lookup,
  {timeoutMs = 5_000, maxBytes = 64 * 1024, userAgent} = {}
) {
  return new Promise((resolve, reject) => {
    if (userAgent !== undefined && !isValidUserAgent(userAgent)) {
      reject(new Error('refusing to fetch: userAgent must be 1 to 200 printable ASCII characters'));
      return;
    }
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

    let settled = false;
    /** Set once headers arrive: resolves with whatever body has been read so far, as truncated. */
    /** @type {(() => void) | null} */
    let finishPartial = null;

    /** @param {Error} err */
    const fail = err => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req.destroy();
      reject(err);
    };
    /** @param {PrefixResult} result */
    const succeed = result => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      // Stop the download: nothing past the prefix is wanted.
      req.destroy();
      resolve(result);
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        // @ts-expect-error - see fetchJsonWithLookup's identical comment on `lookup`.
        lookup,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'identity',
          ...(userAgent === undefined ? {} : {'User-Agent': userAgent}),
        },
      },
      res => {
        const status = res.statusCode ?? 0;
        const headers = collectPrefixHeaders(res.rawHeaders);
        const redirectLocation = headers.location[0] ?? null;

        /** @param {PrefixResult['bodyRead']} bodyRead */
        const skipped = bodyRead =>
          succeed({
            status,
            redirectLocation,
            headers,
            body: Buffer.alloc(0),
            bodyRead,
            truncated: false,
          });

        if (status < 200 || status >= 300) return skipped('skipped-status');
        const contentType = (headers['content-type'][0] || '').toLowerCase();
        // An absent Content-Type is read: browsers sniff, and so do most pages' consumers.
        if (contentType && !/^(text\/html|application\/xhtml\+xml)\b/.test(contentType)) {
          return skipped('skipped-not-html');
        }
        const encodings = headers['content-encoding'].map(v => v.trim().toLowerCase());
        if (encodings.some(v => v !== '' && v !== 'identity')) return skipped('skipped-compressed');

        let total = 0;
        /** @type {Buffer[]} */
        const chunks = [];
        /** @param {boolean} truncated */
        const finish = truncated =>
          succeed({
            status,
            redirectLocation,
            headers,
            body: Buffer.concat(chunks),
            bodyRead: 'html',
            truncated,
          });
        finishPartial = () => finish(true);

        res.on('data', chunk => {
          if (settled) return;
          if (total + chunk.length > maxBytes) {
            chunks.push(chunk.subarray(0, maxBytes - total));
            total = maxBytes;
            finish(true);
            return;
          }
          total += chunk.length;
          chunks.push(chunk);
        });
        // A reset or abort after the headers leaves a partial prefix: report it as truncated.
        res.on('error', () => finish(true));
        res.on('close', () => finish(!(/** @type {{complete?: boolean}} */ (res).complete)));
        res.on('end', () => finish(false));
      }
    );

    const deadline = setTimeout(() => {
      if (finishPartial) finishPartial();
      else fail(new Error(`fetch of "${urlString}" timed out after ${timeoutMs}ms`));
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
 * @return {Promise<{status: number, redirectLocation?: string}>}
 */
function safeFetchStatus(urlString, options) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new Error(`"${urlString}" is not a valid URL`));
  }
  const literalIp = literalIpOf(url);
  if (literalIp && isBlockedAddress(literalIp)) {
    return Promise.reject(
      new Error(
        `refusing to fetch "${urlString}": a private/reserved IP address (${literalIp}).${optInHint(
          literalIp
        )}`
      )
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
  const literalIp = literalIpOf(url);
  if (literalIp && isBlockedAddress(literalIp)) {
    return Promise.reject(
      new Error(
        `refusing to fetch "${urlString}": a private/reserved IP address (${literalIp}).${optInHint(
          literalIp
        )}`
      )
    );
  }

  return fetchJsonWithLookup(urlString, safeLookup, options);
}

/**
 * Fetches a URL's raw bytes, with the same SSRF/DoS protections as `safeFetchJson`: scheme
 * allowlist, private/reserved-IP blocking (literal and post-DNS), DNS-rebinding-resistant lookup,
 * no redirects followed, a total timeout, and a byte cap. Non-2xx responses are *returned*, not
 * thrown, so the caller can record the status (and a redirect's `Location`). An optional validated
 * `userAgent` identifies the caller (see `fetchBytesWithLookup`).
 * @param {string} urlString
 * @param {{timeoutMs?: number, maxBytes?: number, userAgent?: string}} [options]
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
  const literalIp = literalIpOf(url);
  if (literalIp && isBlockedAddress(literalIp)) {
    return Promise.reject(
      new Error(
        `refusing to fetch "${urlString}": a private/reserved IP address (${literalIp}).${optInHint(
          literalIp
        )}`
      )
    );
  }

  return fetchBytesWithLookup(urlString, safeLookup, options);
}

/**
 * Fetches a URL's headers and the first bytes of a 2xx HTML body (see `fetchPrefixWithLookup`), with
 * the same SSRF/DoS protections as `safeFetchBytes`: scheme allowlist, private-address blocking for
 * literal and resolved addresses (one decision point, `isBlockedAddress`, including the private-network
 * opt-in), no redirects followed, a total deadline, and a hard cap on the bytes read.
 * @param {string} urlString
 * @param {{timeoutMs?: number, maxBytes?: number, userAgent?: string}} [options]
 * @return {Promise<PrefixResult>}
 */
function safeFetchPrefix(urlString, options) {
  // Same literal-IP bypass as the other exports: Node skips `lookup` for a literal-IP hostname, so
  // it must be checked explicitly before the request is made.
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new Error(`"${urlString}" is not a valid URL`));
  }
  const literalIp = literalIpOf(url);
  if (literalIp && isBlockedAddress(literalIp)) {
    return Promise.reject(
      new Error(
        `refusing to fetch "${urlString}": a private/reserved IP address (${literalIp}).${optInHint(
          literalIp
        )}`
      )
    );
  }

  return fetchPrefixWithLookup(urlString, safeLookup, options);
}

/**
 * `safeFetchStatus` for a URL on someone else's site (a thumbnail on a CDN, a `sameAs` profile address): a status request with the same
 * protections, but a private or reserved address is refused **whatever the environment says**, and a literal IP is refused *before*
 * any connection (Node skips the `lookup` option for an IP literal, so the lookup alone cannot catch `http://127.0.0.1/`,
 * `http://[::ffff:127.0.0.1]/` or the decimal and hex spellings, which `new URL` normalises to an IP literal). Calling
 * `statusWithLookup` directly with `publicOnlyLookup` does NOT have this check: use this function.
 * @param {string} urlString
 * @param {{timeoutMs?: number}} [options]
 * @return {Promise<{status: number, redirectLocation?: string}>}
 */
function safeFetchPublicStatus(urlString, options) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new Error(`"${urlString}" is not a valid URL`));
  }
  const literalIp = literalIpOf(url);
  if (literalIp && isPrivateOrReservedIp(literalIp)) {
    return Promise.reject(
      new Error(`refusing to fetch "${urlString}": a private/reserved IP address (${literalIp}).`)
    );
  }
  return statusWithLookup(urlString, publicOnlyLookup, options);
}

/**
 * `safeFetchPrefix` for a URL on someone else's site (a link from the audited page): the same protections (scheme
 * allowlist, no redirects followed, a total deadline, a byte cap, a validated user-agent), but a private or
 * reserved address is refused **whatever the environment says**: the private-network opt-in is for auditing your
 * own site and must never let a page steer a request at loopback, a private network or a metadata address.
 * @param {string} urlString
 * @param {{timeoutMs?: number, maxBytes?: number, userAgent?: string}} [options]
 * @return {Promise<PrefixResult>}
 */
function safeFetchPublicPrefix(urlString, options) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new Error(`"${urlString}" is not a valid URL`));
  }
  const literalIp = literalIpOf(url);
  if (literalIp && isPrivateOrReservedIp(literalIp)) {
    return Promise.reject(
      new Error(`refusing to fetch "${urlString}": a private/reserved IP address (${literalIp}).`)
    );
  }
  return fetchPrefixWithLookup(urlString, publicOnlyLookup, options);
}

export {
  ALLOW_PRIVATE_NETWORK_ENV,
  isBlockedAddress,
  isPermittedPrivateAddress,
  safeFetchBytes,
  safeFetchPrefix,
  safeFetchPublicPrefix,
  safeFetchPublicStatus,
  safeFetchJson,
  safeFetchStatus,
  isPrivateOrReservedIp,
  safeLookup,
  publicOnlyLookup,
  fetchJsonWithLookup,
  statusWithLookup,
  fetchBytesWithLookup,
  fetchPrefixWithLookup,
};
