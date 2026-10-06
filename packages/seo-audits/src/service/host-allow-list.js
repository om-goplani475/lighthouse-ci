/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The per-project list of hosts a webhook may ask the service to audit. Mandatory: an empty list allows nothing, so a
 * project that has not chosen its hosts cannot make the service fetch arbitrary addresses. This is a second guard on
 * top of the network guard in `safe-fetch.js` (public addresses only), not a replacement for it.
 *
 * An entry is an exact host (`preview.example.com`) or a subdomain wildcard (`*.example.com`, which matches
 * `a.example.com` and `a.b.example.com` but not `example.com` itself). Ports are not part of the match.
 */

const HOST_PATTERN =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const MAX_ENTRIES = 50;

/**
 * @param {unknown} list
 * @return {string[]} Problems found; empty when the list is valid.
 */
function validateAllowList(list) {
  if (!Array.isArray(list)) return ['allowedHosts must be a list'];
  /** @type {string[]} */
  const problems = [];
  if (list.length === 0) problems.push('allowedHosts must name at least one host');
  if (list.length > MAX_ENTRIES) {
    problems.push(`allowedHosts may have at most ${MAX_ENTRIES} entries`);
  }
  for (const entry of list.slice(0, MAX_ENTRIES)) {
    if (typeof entry !== 'string' || entry.length > 253 || !HOST_PATTERN.test(entry)) {
      problems.push(
        `allowedHosts: "${String(entry).slice(0, 60)}" is not a host or *.host pattern`
      );
    } else if (/(^|\.)\d+$/.test(entry)) {
      problems.push(`allowedHosts: "${entry}" looks like an IP address; name the host instead`);
    } else if (entry === '*.' || /^\*\.[^.]+$/.test(entry)) {
      problems.push(
        `allowedHosts: "${entry}" is too broad (a wildcard needs a registrable domain)`
      );
    }
  }
  return problems;
}

/**
 * @param {string} urlString
 * @param {string[]} allowedHosts
 * @return {{ok: true, url: string} | {ok: false, reason: string}} On success `url` is the normalised address to audit.
 */
function checkAuditUrl(urlString, allowedHosts) {
  if (typeof urlString !== 'string' || urlString.length > 2048) {
    return {ok: false, reason: 'url missing or too long'};
  }
  /** @type {URL} */
  let url;
  try {
    url = new URL(urlString);
  } catch (_) {
    return {ok: false, reason: 'url is not valid'};
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {ok: false, reason: 'url must be http or https'};
  }
  if (url.username || url.password) return {ok: false, reason: 'url must not contain credentials'};
  if (validateAllowList(allowedHosts).length) {
    return {ok: false, reason: 'the project has no valid host allow-list'};
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = allowedHosts.some(entry => {
    const e = entry.toLowerCase();
    return e.startsWith('*.') ? host.endsWith(e.slice(1)) : host === e;
  });
  if (!allowed) return {ok: false, reason: `host "${host}" is not on the project's allow-list`};
  url.hash = '';
  return {ok: true, url: url.href};
}

export {validateAllowList, checkAuditUrl, MAX_ENTRIES};
