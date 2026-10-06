/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sends what a finished run produced: the sticky pull request comment (GitHub or GitLab) and Slack or Teams alerts for new
 * critical regressions. The request mechanics (https only, public addresses only, no redirects, timeouts) are in
 * `outbound.js`; this file decides *where* a project may send things and *what* is worth sending.
 *
 * Destinations are untrusted settings, so each kind is limited to the hosts it can legitimately name: Slack to
 * `hooks.slack.com`, Teams to Microsoft's webhook hosts, GitHub and GitLab to their API base (default the public cloud,
 * or a self-hosted base the project gives, still https and public only). Tokens and webhook URLs are secrets: they are
 * never put in a result, a log line or an error message (`redact`).
 */

import {CATEGORIES} from '../summary/categories.js';
import {renderPrComment, markerFor, alertParts, slackBody, teamsBody} from './pr-comment.js';

const KNOWN_AUDITS = new Set(CATEGORIES.flatMap(c => c.audits));

/** Error-tier audits that mean "search engines may not see or trust this page". A new one raises an alert. */
const DEFAULT_CRITICAL_AUDITS = [
  'robots-directives-conflict',
  'indexability-conflicts',
  'robots-txt-crawler-access',
  'canonical-conflicts',
  'canonical-https',
  'redirect-loop',
  'sitemap-valid',
  'mixed-content',
  'ssl-certificate-expiry',
];
/** Lighthouse's own audits, read from the report: a page that was crawlable and is not, or that answered with an error status. */
const SIGNAL_IDS = ['is-crawlable', 'http-status-code'];

const SLACK_HOSTS = ['hooks.slack.com'];
const TEAMS_HOST =
  /(^|\.)(webhook\.office\.com|logic\.azure\.com|environment\.api\.powerplatform\.com)$|^outlook\.office(365)?\.com$/;
const LEGACY_TEAMS_HOST = /(^|\.)webhook\.office\.com$|^outlook\.office(365)?\.com$/;
const MAX_COMMENT_PAGES = 5;

/**
 * @param {unknown} value
 * @return {boolean}
 */
function isToken(value) {
  // Tokens are printable ASCII with no spaces (GitHub, GitLab).
  return typeof value === 'string' && /^[\x21-\x7e]{8,500}$/.test(value);
}

/**
 * @param {unknown} value
 * @param {(host: string) => boolean} hostOk
 * @return {URL | null}
 */
function httpsUrl(value, hostOk) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return hostOk(host) ? url : null;
  } catch (_) {
    return null;
  }
}

/** @param {string} host @return {boolean} A plain DNS name (no IP literal, no bare label). */
const isDnsName = host => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^[\d.]+$/.test(host);

/**
 * @param {any} config
 * @return {string[]} Problems; empty when valid. A `null` field means "remove it" and is valid.
 */
function validateNotifications(config) {
  if (config === null || config === undefined) return [];
  if (typeof config !== 'object' || Array.isArray(config)) {
    return ['notifications must be an object'];
  }
  /** @type {string[]} */
  const problems = [];
  const allowed = new Set(['github', 'gitlab', 'slack', 'teams', 'alerts', 'comment']);
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) problems.push(`notifications: unknown setting "${key}"`);
  }

  for (const kind of /** @type {const} */ (['github', 'gitlab'])) {
    const c = config[kind];
    if (c === undefined || c === null) continue;
    if (typeof c !== 'object' || Array.isArray(c)) {
      problems.push(`${kind} must be an object`);
      continue;
    }
    if (c.token !== undefined && !isToken(c.token)) {
      problems.push(`${kind}.token must be 8 to 500 characters with no spaces`);
    }
    if (c.apiBase !== undefined && c.apiBase !== null) {
      const url = httpsUrl(c.apiBase, isDnsName);
      if (!url || url.search || url.pathname.length > 100) {
        problems.push(`${kind}.apiBase must be an https URL on a public host name, with no query`);
      }
    }
  }
  const slack = config.slack;
  if (slack !== undefined && slack !== null) {
    const url = slack && httpsUrl(slack.webhookUrl, h => SLACK_HOSTS.includes(h));
    if (!url) {
      problems.push(
        'slack.webhookUrl must be an https Slack incoming-webhook URL (hooks.slack.com)'
      );
    }
  }
  const teams = config.teams;
  if (teams !== undefined && teams !== null) {
    const url = teams && httpsUrl(teams.webhookUrl, h => TEAMS_HOST.test(h));
    if (!url) {
      problems.push(
        'teams.webhookUrl must be an https Microsoft Teams webhook URL (webhook.office.com or logic.azure.com)'
      );
    }
  }
  const alerts = config.alerts;
  if (alerts !== undefined && alerts !== null) {
    if (typeof alerts !== 'object' || Array.isArray(alerts)) {
      problems.push('alerts must be an object');
    } else {
      if (alerts.audits !== undefined) {
        if (!Array.isArray(alerts.audits) || alerts.audits.length > 60) {
          problems.push('alerts.audits must be a list of audit ids');
        } else {
          for (const id of alerts.audits) {
            if (!KNOWN_AUDITS.has(id)) {
              problems.push(`alerts.audits: unknown audit "${String(id).slice(0, 60)}"`);
            }
          }
        }
      }
      if (
        alerts.includePullRequests !== undefined &&
        typeof alerts.includePullRequests !== 'boolean'
      ) {
        problems.push('alerts.includePullRequests must be true or false');
      }
    }
  }
  if (config.comment !== undefined && typeof config.comment !== 'boolean') {
    problems.push('comment must be true or false');
  }
  return problems;
}

/**
 * Applies a partial update: a field that is left out keeps its old value, `null` removes it, and a nested object is
 * merged (so changing only `github.apiBase` keeps the stored token).
 * @param {any} existing
 * @param {any} patch
 * @return {any}
 */
function mergeNotifications(existing, patch) {
  const merged = {...(existing || {})};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) delete merged[key];
    else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === 'object'
    ) {
      const inner = {...merged[key], ...value};
      for (const [k, v] of Object.entries(inner)) if (v === null) delete inner[k];
      merged[key] = inner;
    } else merged[key] = value;
  }
  return merged;
}

/**
 * @param {any} config
 * @return {object} What may be shown back to a user: which destinations are set up, never a token or a URL's secret part.
 */
function publicNotifications(config) {
  const c = config || {};
  /** @param {string | undefined} u */
  const hostOf = u => {
    try {
      return u ? new URL(u).hostname : null;
    } catch (_) {
      return null;
    }
  };
  return {
    comment: c.comment !== false,
    github: c.github ? {tokenSet: !!c.github.token, apiBase: c.github.apiBase || null} : null,
    gitlab: c.gitlab ? {tokenSet: !!c.gitlab.token, apiBase: c.gitlab.apiBase || null} : null,
    slack: c.slack ? {webhookHost: hostOf(c.slack.webhookUrl)} : null,
    teams: c.teams ? {webhookHost: hostOf(c.teams.webhookUrl)} : null,
    alerts: {
      audits: (c.alerts && c.alerts.audits) || DEFAULT_CRITICAL_AUDITS,
      includePullRequests: !!(c.alerts && c.alerts.includePullRequests),
    },
  };
}

/**
 * @param {string} text
 * @param {string[]} secrets
 * @return {string}
 */
function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[redacted]');
  }
  return out.slice(0, 300);
}

/**
 * New critical regressions: an alert-worthy audit that fails now and did not in the baseline, or a page that stopped being
 * crawlable. Needs a baseline: without one there is nothing to call "new", and a site that was already broken should not
 * page anyone on its first audit.
 * @param {any} result What the runner stored.
 * @param {string[]} [audits] The audit ids that count.
 * @return {Array<{id: string, title: string, detail?: string}>}
 */
function criticalRegressions(result, audits = DEFAULT_CRITICAL_AUDITS) {
  const comparison = result && result.comparison;
  if (!comparison || !Array.isArray(comparison.newIssues)) return [];
  const wanted = new Set(audits);
  /** @type {Array<{id: string, title: string, detail?: string}>} */
  const out = [];
  for (const a of comparison.newIssues) {
    if (a && a.tier === 'error' && wanted.has(a.id)) {
      out.push({
        id: a.id,
        title: String(a.title || a.id),
        detail: a.displayValue || a.explanation || undefined,
      });
    }
  }
  const now = result.signals;
  const before = result.baselineSignals;
  if (now && before) {
    for (const id of SIGNAL_IDS) {
      if (now[id] && before[id] && now[id].score === 0 && before[id].score === 1) {
        out.push({
          id,
          title: String(now[id].title || id),
          detail: now[id].displayValue || undefined,
        });
      }
    }
  }
  return out;
}

/**
 * Retries once on a network error, a 429 or a 5xx.
 * @param {Function} send
 * @param {(ms: number) => Promise<void>} sleep
 * @return {Function}
 */
function withRetry(send, sleep) {
  return async (/** @type {any} */ request) => {
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await send(request);
        if (res.status !== 429 && res.status < 500) return res;
        last = res;
        const wait = Math.min(Number(res.headers && res.headers['retry-after']) || 1, 5) * 1000;
        if (attempt === 0) await sleep(wait);
      } catch (err) {
        if (attempt === 1) throw err;
        await sleep(500);
      }
    }
    return last;
  };
}

/**
 * @param {Function} send
 * @param {{base: string, headers: Record<string, string>, listPath: string, patchPath: (id: number) => string, patchMethod: string, createPath: string, body: string, marker: string, name: string, bodyKey?: string}} job
 * @return {Promise<string>} What was done, for the log.
 */
async function upsertComment(send, job) {
  const {base, headers, marker, name} = job;
  /** @type {number | null} */
  let existing = null;
  for (let page = 1; page <= MAX_COMMENT_PAGES && existing === null; page++) {
    const res = await send({
      method: 'GET',
      url: `${base}${job.listPath}?per_page=100&page=${page}`,
      headers,
    });
    if (res.status !== 200 || !Array.isArray(res.json)) {
      throw new Error(
        `${name} answered ${res.status} when listing comments (check the token's access to the repository)`
      );
    }
    const hit = res.json.find(
      (/** @type {any} */ c) =>
        c && typeof c.body === 'string' && c.body.includes(marker) && !c.system
    );
    if (hit) existing = hit.id;
    if (res.json.length < 100) break;
  }
  if (existing !== null) {
    const res = await send({
      method: job.patchMethod,
      url: `${base}${job.patchPath(existing)}`,
      headers,
      body: {body: job.body},
    });
    if (res.status === 200) return 'comment updated';
    // The marked comment is not ours to edit (someone else pasted the marker): fall through and post our own.
    if (res.status !== 403 && res.status !== 404) {
      throw new Error(`${name} answered ${res.status} when updating the comment`);
    }
  }
  const res = await send({
    method: 'POST',
    url: `${base}${job.createPath}`,
    headers,
    body: {body: job.body},
  });
  if (res.status !== 201) {
    throw new Error(`${name} answered ${res.status} when posting the comment`);
  }
  return 'comment posted';
}

/**
 * @param {{
 *   projectId: string,
 *   run: {provider?: string | null, repo?: string | null, prNumber?: number | null, url: string, sha?: string | null, branch?: string | null, baseBranch?: string | null},
 *   result: any,
 *   notifications: any,
 *   send: Function,
 *   reportUrl?: string | null,
 *   sleep?: (ms: number) => Promise<void>,
 * }} input
 * @return {Promise<Array<{kind: 'comment' | 'alert', target: string, ok: boolean, detail: string}>>} One entry per attempt; never throws.
 */
async function dispatchRun({
  projectId,
  run,
  result,
  notifications,
  send,
  reportUrl = null,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
}) {
  const n = notifications || {};
  const retrying = withRetry(send, sleep);
  const secrets = [
    n.github && n.github.token,
    n.gitlab && n.gitlab.token,
    n.slack && n.slack.webhookUrl,
    n.teams && n.teams.webhookUrl,
  ].filter(Boolean);
  /** @type {Array<{kind: 'comment' | 'alert', target: string, ok: boolean, detail: string}>} */
  const actions = [];
  /** @param {'comment' | 'alert'} kind @param {string} target @param {() => Promise<string>} fn */
  const attempt = async (kind, target, fn) => {
    try {
      actions.push({kind, target, ok: true, detail: await fn()});
    } catch (err) {
      actions.push({
        kind,
        target,
        ok: false,
        detail: redact(/** @type {Error} */ (err).message, secrets),
      });
    }
  };

  // The pull request comment.
  if (n.comment !== false && run.prNumber && run.repo) {
    const marker = markerFor(projectId);
    const body = renderPrComment({projectId, run, result, reportUrl});
    const repo = run.repo;
    if (run.provider === 'github' && n.github && n.github.token) {
      const base = String(n.github.apiBase || 'https://api.github.com').replace(/\/+$/, '');
      const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}/issues`;
      await attempt('comment', 'github', () =>
        upsertComment(retrying, {
          name: 'GitHub',
          base,
          marker,
          body,
          headers: {
            authorization: `Bearer ${n.github.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
          },
          listPath: `${path}/${run.prNumber}/comments`,
          patchPath: id => `${path}/comments/${id}`,
          patchMethod: 'PATCH',
          createPath: `${path}/${run.prNumber}/comments`,
        })
      );
    } else if (run.provider === 'gitlab' && n.gitlab && n.gitlab.token) {
      const base = String(n.gitlab.apiBase || 'https://gitlab.com').replace(/\/+$/, '');
      const path = `/api/v4/projects/${encodeURIComponent(repo)}/merge_requests/${
        run.prNumber
      }/notes`;
      await attempt('comment', 'gitlab', () =>
        upsertComment(retrying, {
          name: 'GitLab',
          base,
          marker,
          body,
          headers: {'private-token': n.gitlab.token},
          listPath: path,
          patchPath: id => `${path}/${id}`,
          patchMethod: 'PUT',
          createPath: path,
        })
      );
    }
  }

  // Alerts for new critical regressions (by default only for runs that are not pull requests).
  const alerts = n.alerts || {};
  const wantsAlerts = !run.prNumber || alerts.includePullRequests === true;
  if (wantsAlerts && (n.slack || n.teams)) {
    const regressions = criticalRegressions(result, alerts.audits || DEFAULT_CRITICAL_AUDITS);
    if (regressions.length) {
      const parts = alertParts({run: {...run, repo: run.repo}, regressions, reportUrl});
      if (n.slack && n.slack.webhookUrl) {
        await attempt('alert', 'slack', async () => {
          const res = await retrying({
            method: 'POST',
            url: n.slack.webhookUrl,
            body: slackBody(parts),
          });
          if (res.status !== 200) throw new Error(`Slack answered ${res.status}`);
          return `alert sent (${regressions.length})`;
        });
      }
      if (n.teams && n.teams.webhookUrl) {
        await attempt('alert', 'teams', async () => {
          const host = new URL(n.teams.webhookUrl).hostname.toLowerCase();
          const res = await retrying({
            method: 'POST',
            url: n.teams.webhookUrl,
            body: teamsBody(parts, LEGACY_TEAMS_HOST.test(host) ? 'messagecard' : 'adaptive'),
          });
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`Teams answered ${res.status}`);
          }
          return `alert sent (${regressions.length})`;
        });
      }
    }
  }
  return actions;
}

export {
  validateNotifications,
  mergeNotifications,
  publicNotifications,
  criticalRegressions,
  dispatchRun,
  redact,
  DEFAULT_CRITICAL_AUDITS,
  SIGNAL_IDS,
};
