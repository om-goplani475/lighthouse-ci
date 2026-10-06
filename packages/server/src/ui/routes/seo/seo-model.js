/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The logic behind the SEO dashboard, kept out of the components so it can be tested without a browser: how a run or a
 * delivery is labelled, how the settings form maps to the saved settings and back, and how the admin token is sent.
 */

/** @typedef {'pass' | 'fail' | 'pending' | 'neutral'} Tone */

const SEVERITIES = ['error', 'warn', 'off'];
const MAX_HOSTS = 50;

const OUTCOMES = /** @type {Record<string, {label: string, tone: Tone}>} */ ({
  accepted: {label: 'Queued', tone: 'pass'},
  ignored: {label: 'Ignored', tone: 'neutral'},
  duplicate: {label: 'Duplicate', tone: 'neutral'},
  rejected: {label: 'Rejected', tone: 'fail'},
  invalid: {label: 'Invalid', tone: 'fail'},
  'rate-limited': {label: 'Rate limited', tone: 'fail'},
  'queue-full': {label: 'Queue full', tone: 'fail'},
  'comment-posted': {label: 'Comment posted', tone: 'pass'},
  'comment-failed': {label: 'Comment failed', tone: 'fail'},
  'alert-sent': {label: 'Alert sent', tone: 'pass'},
  'alert-failed': {label: 'Alert failed', tone: 'fail'},
});

/**
 * @param {string} outcome
 * @return {{label: string, tone: Tone}}
 */
export function describeOutcome(outcome) {
  return OUTCOMES[outcome] || {label: String(outcome || 'Unknown').slice(0, 30), tone: 'neutral'};
}

/**
 * @param {{status?: string, error?: string | null}} run
 * @return {{label: string, tone: Tone}}
 */
export function describeRunStatus(run) {
  switch (run && run.status) {
    case 'done':
      return {label: 'Done', tone: 'pass'};
    case 'failed':
      return {label: 'Failed', tone: 'fail'};
    case 'running':
      return {label: 'Running', tone: 'pending'};
    case 'queued':
      return {label: 'Queued', tone: 'pending'};
    default:
      return {label: 'Unknown', tone: 'neutral'};
  }
}

/**
 * @param {any[] | undefined} runs
 * @return {boolean} Whether any run is still waiting or running, so the list should keep refreshing.
 */
export function hasActiveRun(runs) {
  return (
    Array.isArray(runs) && runs.some(r => r && (r.status === 'queued' || r.status === 'running'))
  );
}

/**
 * @param {number | null | undefined} score
 * @return {Tone}
 */
export function scoreTone(score) {
  if (typeof score !== 'number') return 'neutral';
  return score >= 90 ? 'pass' : score >= 70 ? 'pending' : 'fail';
}

/**
 * @param {number | null | undefined} n
 * @return {string}
 */
export function formatScore(n) {
  return typeof n === 'number' ? n.toFixed(1) : 'n/a';
}

/**
 * @param {number | null | undefined} d
 * @return {string}
 */
export function formatDelta(d) {
  if (typeof d !== 'number') return '';
  if (d === 0) return '±0';
  return d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
}

/**
 * @param {string | null | undefined} startedAt
 * @param {string | null | undefined} finishedAt
 * @return {string}
 */
export function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return '';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * @param {string | null | undefined} sha
 * @return {string}
 */
export function shortSha(sha) {
  return /^[0-9a-f]{7,64}$/i.test(String(sha || '')) ? String(sha).slice(0, 7).toLowerCase() : '';
}

/**
 * @param {string | null | undefined} url
 * @return {string} The part of a URL worth showing in a table (host and path), never throwing.
 */
export function shortUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch (_) {
    return String(url || '').slice(0, 80);
  }
}

/**
 * @param {string | null | undefined} url
 * @return {string | null} The URL when it is a plain http(s) address that is safe to put in a link, else null.
 */
export function safeLink(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch (_) {
    return null;
  }
}

/** @param {string[] | undefined} hosts @return {string} */
export function hostsToText(hosts) {
  return (hosts || []).join('\n');
}

/**
 * @param {string} text Hosts separated by new lines, commas or spaces.
 * @return {string[]} Trimmed, de-duplicated, lower-cased, at most 50 (the server validates each one).
 */
export function textToHosts(text) {
  const seen = new Set();
  for (const part of String(text || '').split(/[\s,]+/)) {
    const host = part.trim().toLowerCase();
    if (host) seen.add(host);
  }
  return [...seen].slice(0, MAX_HOSTS);
}

/**
 * @param {{preset?: string, categories?: Record<string, string>, audits?: Record<string, string>} | null | undefined} config
 * @param {string} defaultPreset
 * @return {{preset: string, categories: Record<string, string>, audits: Record<string, string>}} The form's state: an empty string means "inherit".
 */
export function configToForm(config, defaultPreset) {
  const c = config || {};
  return {
    preset: c.preset || defaultPreset,
    categories: {...(c.categories || {})},
    audits: {...(c.audits || {})},
  };
}

/**
 * @param {{preset: string, categories: Record<string, string>, audits: Record<string, string>}} form
 * @return {{preset: string, categories: Record<string, string>, audits: Record<string, string>}} Only the overrides that were actually chosen.
 */
export function formToConfig(form) {
  /** @param {Record<string, string>} map */
  const chosen = map =>
    Object.fromEntries(Object.entries(map || {}).filter(([, v]) => SEVERITIES.includes(v)));
  return {preset: form.preset, categories: chosen(form.categories), audits: chosen(form.audits)};
}

/**
 * Builds the notifications update from the form. A secret field left empty means "keep what is stored" (the server never
 * sends secrets back), so it is left out; a destination marked for removal is sent as null.
 * @param {{
 *   comment: boolean, includePullRequests: boolean,
 *   github: {token: string, apiBase: string, remove: boolean}, gitlab: {token: string, apiBase: string, remove: boolean},
 *   slack: {webhookUrl: string, remove: boolean}, teams: {webhookUrl: string, remove: boolean},
 * }} form
 * @return {Record<string, any>}
 */
export function formToNotifications(form) {
  /** @type {Record<string, any>} */
  const patch = {comment: form.comment, alerts: {includePullRequests: form.includePullRequests}};
  for (const kind of /** @type {const} */ (['github', 'gitlab'])) {
    const f = form[kind];
    if (f.remove) patch[kind] = null;
    else {
      /** @type {Record<string, string | null>} */
      const part = {};
      if (f.token.trim()) part.token = f.token.trim();
      part.apiBase = f.apiBase.trim() || null;
      if (Object.keys(part).length) patch[kind] = part;
    }
  }
  for (const kind of /** @type {const} */ (['slack', 'teams'])) {
    const f = form[kind];
    if (f.remove) patch[kind] = null;
    else if (f.webhookUrl.trim()) patch[kind] = {webhookUrl: f.webhookUrl.trim()};
  }
  return patch;
}

/**
 * @param {string} projectId
 * @param {string} runId
 * @return {string} The address of a run's page: the one the pull request comment links to.
 */
export function runPagePath(projectId, runId) {
  return `/app/seo/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`;
}

/**
 * Sends a request to the SEO API as the project's admin. Never throws: the answer says what happened, so a screen can
 * tell "no token" and "wrong token" apart from a server error.
 * @param {{
 *   fetch: typeof fetch, projectId: string, adminToken: string | undefined, method?: string, path: string, body?: unknown,
 * }} request
 * @return {Promise<{state: 'ok' | 'no-token' | 'unauthorized' | 'not-found' | 'invalid' | 'busy' | 'error', status: number, data: any, message: string}>}
 */
export async function seoRequest({
  fetch: doFetch,
  projectId,
  adminToken,
  method = 'GET',
  path,
  body,
}) {
  if (!adminToken)
    return {
      state: 'no-token',
      status: 0,
      data: null,
      message: 'Enter the project admin token first.',
    };
  try {
    const res = await doFetch(`/api/v1/seo/projects/${encodeURIComponent(projectId)}${path}`, {
      method,
      headers: {
        'x-lhci-admin-token': adminToken,
        ...(body !== undefined && {'content-type': 'application/json'}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    const text = res.status === 204 ? '' : await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      // not JSON
    }
    const message = (data && data.message) || '';
    const problems = data && Array.isArray(data.problems) ? ` ${data.problems.join('; ')}` : '';
    if (res.ok) return {state: 'ok', status: res.status, data, message};
    if (res.status === 403)
      return {
        state: 'unauthorized',
        status: 403,
        data,
        message: 'The admin token was not accepted.',
      };
    if (res.status === 404)
      return {state: 'not-found', status: 404, data, message: message || 'Not found.'};
    if (res.status === 422)
      return {state: 'invalid', status: 422, data, message: `${message}${problems}`.trim()};
    if (res.status === 429 || res.status === 503)
      return {state: 'busy', status: res.status, data, message: message || 'Try again later.'};
    return {
      state: 'error',
      status: res.status,
      data,
      message: message || `The server answered ${res.status}.`,
    };
  } catch (err) {
    return {state: 'error', status: 0, data: null, message: 'Could not reach the server.'};
  }
}
