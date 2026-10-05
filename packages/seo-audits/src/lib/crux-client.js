/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * A minimal client for Google's Chrome UX Report (CrUX) API, the real-user ("field") data behind the Core Web
 * Vitals. One POST to a fixed host, `chromeuxreport.googleapis.com`: no URL taken from the audited page is ever
 * requested (the page address only travels in the JSON body), so this needs no SSRF address policy.
 *
 * The API key is sent in the `X-Goog-Api-Key` header, never in the URL, and is never returned, logged or put in
 * an error message. No redirect is followed. The response is capped at 256 KiB and the request at 8 s.
 * Every outcome is data, never a throw.
 */

import https from 'https';

const HOST = 'chromeuxreport.googleapis.com';
const PATH = '/v1/records:queryRecord';
const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const METRICS = [
  'largest_contentful_paint',
  'interaction_to_next_paint',
  'cumulative_layout_shift',
  'first_contentful_paint',
  'experimental_time_to_first_byte',
];

/**
 * @typedef {{status: number, body: string}} RawResponse
 * @typedef {(options: {host: string, path: string, headers: Record<string, string | number>, body: string, timeoutMs: number, maxBytes: number}) => Promise<RawResponse>} PostFn
 * @typedef {{state: 'ok', record: any} | {state: 'no-data'} | {state: 'error', reason: string}} CruxResult
 */

/**
 * The real network call, injectable so tests never touch the network.
 * @type {PostFn}
 */
function httpsPost({host, path, headers, body, timeoutMs, maxBytes}) {
  return new Promise((resolve, reject) => {
    const req = https.request({host, path, method: 'POST', headers, timeout: timeoutMs}, res => {
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error('the response was larger than the limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        resolve({status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8')})
      );
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * @param {unknown} err
 * @param {string} apiKey
 * @return {string} A short reason that cannot contain the key.
 */
function describeError(err, apiKey) {
  const message = err instanceof Error ? err.message : String(err);
  const scrubbed = apiKey ? message.split(apiKey).join('[key]') : message;
  return scrubbed.slice(0, 120);
}

/**
 * @param {{
 *   apiKey: string,
 *   target: {url: string} | {origin: string},
 *   formFactor?: 'PHONE' | 'DESKTOP',
 *   post?: PostFn,
 * }} input
 * @return {Promise<CruxResult>}
 */
async function queryCrux({apiKey, target, formFactor, post = httpsPost}) {
  try {
    const body = JSON.stringify({...target, ...(formFactor ? {formFactor} : {}), metrics: METRICS});
    const response = await post({
      host: HOST,
      path: PATH,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Goog-Api-Key': apiKey,
      },
      body,
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
    });
    if (response.status === 404) return {state: 'no-data'};
    if (response.status < 200 || response.status >= 300) {
      const hint =
        response.status === 400 || response.status === 403
          ? ' (check the key and that the Chrome UX Report API is enabled for it)'
          : response.status === 429
          ? ' (quota exceeded)'
          : '';
      return {state: 'error', reason: `the CrUX API answered ${response.status}${hint}`};
    }
    const json = JSON.parse(response.body);
    const record = json && typeof json === 'object' ? json.record : null;
    if (!record || typeof record !== 'object' || !record.metrics) return {state: 'no-data'};
    return {state: 'ok', record};
  } catch (err) {
    return {state: 'error', reason: `the CrUX request failed (${describeError(err, apiKey)})`};
  }
}

export {queryCrux, httpsPost, HOST, PATH, METRICS, TIMEOUT_MS, MAX_RESPONSE_BYTES};
