/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The service's only way to send a request out (PR comments, Slack and Teams alerts). The destinations come from a
 * project's settings, so they are treated as untrusted: HTTPS only, no credentials in the URL, a public address only
 * (the same lookup guard as the audits; a name that resolves to a private address is refused, and the connection goes to
 * the address that was checked), no redirects followed (a redirect could carry the token to another host), a timeout and
 * a response size cap. The callers decide which hosts a destination may name; this only enforces how a request is made.
 */

import http from 'http';
import https from 'https';
import net from 'net';
import {publicOnlyLookup, isPrivateOrReservedIp} from '../lib/safe-fetch.js';

/**
 * @param {{
 *   lookup?: typeof publicOnlyLookup, allowHttp?: boolean, timeoutMs?: number, maxBytes?: number, userAgent?: string,
 * }} [options] `lookup` and `allowHttp` exist for tests; the defaults are the strict production behaviour.
 * @return {(request: {method: string, url: string, headers?: Record<string, string>, body?: unknown}) => Promise<{status: number, headers: Record<string, any>, text: string, json: any}>}
 */
function createOutbound({
  lookup = publicOnlyLookup,
  allowHttp = false,
  timeoutMs = 10_000,
  maxBytes = 1_000_000,
  userAgent = 'lhci-seo-service',
} = {}) {
  return function send({method, url, headers = {}, body}) {
    return new Promise((resolve, reject) => {
      /** @type {URL} */
      let target;
      try {
        target = new URL(url);
      } catch (_) {
        reject(new Error('the destination is not a valid URL'));
        return;
      }
      const secure = target.protocol === 'https:';
      if (!secure && !(allowHttp && target.protocol === 'http:')) {
        reject(new Error('the destination must use https'));
        return;
      }
      if (target.username || target.password) {
        reject(new Error('the destination must not contain credentials'));
        return;
      }
      const bare = target.hostname.replace(/^\[|\]$/g, '');
      if (lookup === publicOnlyLookup && net.isIP(bare) && isPrivateOrReservedIp(bare)) {
        reject(new Error(`refusing to connect to "${bare}": a private or reserved address`));
        return;
      }

      const payload =
        body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const options = /** @type {any} */ ({
        method,
        hostname: bare,
        port: target.port || (secure ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        headers: {
          'user-agent': userAgent,
          accept: 'application/json',
          ...(payload !== undefined && {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          }),
          ...headers,
        },
        lookup,
        agent: false,
      });

      let settled = false;
      /** @param {() => void} fn */
      const once = fn => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn();
        }
      };
      const req = (secure ? https : http).request(options, res => {
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            once(() => reject(new Error('the response was too large')));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          /** @type {any} */
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (_) {
            // not JSON: callers use `text`
          }
          once(() => resolve({status: res.statusCode || 0, headers: res.headers, text, json}));
        });
        res.on('error', err => once(() => reject(err)));
      });
      const timer = setTimeout(() => {
        req.destroy();
        once(() => reject(new Error('the request timed out')));
      }, timeoutMs);
      timer.unref();
      req.on('error', err => once(() => reject(err)));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  };
}

export {createOutbound};
