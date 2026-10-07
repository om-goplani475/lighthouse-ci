/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * HTTP side of the SEO webhook service.
 *
 * - `webhooks` (mount BEFORE the body parser and basic auth): `POST /:projectId`. Proof of origin is the signature, not a
 *   password. The raw bytes are kept for the signature check, with a 1 MB cap.
 * - `management` (mount AFTER auth and the body parser): project settings, run history, webhook log, on-demand runs. All
 *   guarded by the LHCI project's admin token.
 *
 * The pure checks come in as `deps` (they live in the ESM package `@lhci/seo-audits`; see `load-deps.js`), so this file
 * is plain CommonJS and tests can pass the real modules or fakes.
 */
'use strict';

const express = require('express');
const {createSeoStore} = require('./seo-store.js');
const {createSecretBox} = require('./secret-box.js');
const {createQueue, createRateLimiter} = require('./seo-queue.js');
const {validateAdminTokenMiddleware, handleAsyncError} = require('../api/express-utils.js');

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PROVIDERS = ['github', 'gitlab', 'lhci'];
const EVENT_HEADERS = {github: 'x-github-event', gitlab: 'x-gitlab-event', lhci: ''};
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const DISPATCH_TIMEOUT_MS = 60 * 1000;

/**
 * @typedef {{
 *   verifyWebhook: (input: any) => any,
 *   createReplayGuard: (options?: any) => {seen: (key: string, now?: number) => boolean},
 *   normalizeWebhook: (input: any) => any,
 *   checkAuditUrl: (url: string, hosts: string[]) => any,
 *   validateAllowList: (list: unknown) => string[],
 *   validateConfig: (config: any) => string[],
 *   validateNotifications?: (config: any) => string[],
 *   mergeNotifications?: (existing: any, patch: any) => any,
 *   publicNotifications?: (config: any) => object,
 *   dispatchRun?: (input: any) => Promise<Array<{kind: string, target: string, ok: boolean, detail: string}>>,
 *   send?: Function,
 *   describeProject?: (config: any) => object,
 *   runAudit?: (input: any) => Promise<unknown>,
 * }} SeoDeps
 */

/**
 * @param {string} text
 * @param {any} fallback
 * @return {any}
 */
function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * The public view of a project: everything except the secret.
 * @param {any} row
 */
function publicProject(row) {
  return {
    projectId: row.projectId,
    provider: row.provider,
    config: parseJson(row.config, {}),
    allowedHosts: parseJson(row.allowedHosts, []),
    defaultUrl: row.defaultUrl || null,
    webhookPath: `/api/v1/webhooks/${row.projectId}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * @param {{storageMethod: any, options?: any}} context
 * @param {SeoDeps} deps
 * @param {{maxQueued?: number, concurrency?: number, rateMax?: number, rateWindowMs?: number, jobTimeoutMs?: number}} [limits]
 * @return {Promise<{webhooks: import('express').Router, management: import('express').Router, store: any, queue: any}>}
 */
async function createSeoService(context, deps, limits = {}) {
  const secretBox = createSecretBox({
    key: process.env.LHCI_SEO_SECRET_KEY,
    previousKey: process.env.LHCI_SEO_SECRET_KEY_PREVIOUS,
  });
  const store = await createSeoStore(context.storageMethod._sql().sequelize, secretBox);
  if (!secretBox.enabled) {
    process.emitWarning(
      'LHCI_SEO_SECRET_KEY is not set: the SEO service stores webhook secrets and notification tokens unencrypted.',
      'SeoServiceWarning'
    );
  }
  await store.sealStoredSecrets();
  await store.failOrphans();
  const replay = deps.createReplayGuard();
  // Failed signatures are logged so an owner can see them, but anyone who knows a project's webhook URL can send them, so
  // the log writes are capped: an unauthenticated caller must not be able to fill the database.
  const rejectedLogLimiter = createRateLimiter({max: 20, windowMs: 60 * 1000});
  const limiter = createRateLimiter({max: limits.rateMax, windowMs: limits.rateWindowMs});
  const jobTimeoutMs = limits.jobTimeoutMs || JOB_TIMEOUT_MS;

  /**
   * Posts the comment and sends the alerts for a finished run. A failure here is logged and never changes the run: the
   * audit succeeded, only the messenger did not.
   * @param {any} run
   * @param {any} result
   */
  const dispatch = async (run, result) => {
    if (!deps.dispatchRun || !deps.send) return;
    try {
      const notifications = await store.getNotifications(run.projectId);
      if (!notifications) return;
      const publicUrl = String(process.env.LHCI_SEO_PUBLIC_URL || '').replace(/\/+$/, '');
      const actions = await Promise.race([
        deps.dispatchRun({
          projectId: run.projectId,
          run,
          result,
          notifications,
          send: deps.send,
          reportUrl: publicUrl ? `${publicUrl}/app/seo/${run.projectId}/runs/${run.id}` : null,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('sending took too long')), DISPATCH_TIMEOUT_MS).unref()
        ),
      ]);
      for (const a of /** @type {any[]} */ (actions)) {
        await log({
          projectId: run.projectId,
          provider: run.provider,
          event: a.target,
          outcome: `${a.kind}-${a.ok ? (a.kind === 'comment' ? 'posted' : 'sent') : 'failed'}`,
          reason: a.detail,
          runId: run.id,
        });
      }
    } catch (err) {
      await log({
        projectId: run.projectId,
        provider: run.provider,
        event: 'dispatch',
        outcome: 'comment-failed',
        reason: /** @type {Error} */ (err).message,
        runId: run.id,
      });
    }
  };

  /** @param {{runId: string, projectId: string}} job */
  const execute = async job => {
    const run = await store.getRun(job.runId);
    if (!run) return;
    await store.updateRun(run.id, {status: 'running', startedAt: new Date()});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), jobTimeoutMs);
    timer.unref();
    try {
      if (!deps.runAudit) throw new Error('the audit runner is not installed on this server');
      const project = await store.getProject(job.projectId);
      if (!project) throw new Error('the project was removed');
      const aborted = new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new Error('the run took too long'))
        )
      );
      const result = await Promise.race([
        deps.runAudit({
          run,
          project,
          config: parseJson(project.config, {}),
          allowedHosts: parseJson(project.allowedHosts, []),
          signal: controller.signal,
          // Compare with the latest finished run on the base branch (or, for a base-branch run, its own branch).
          findBaseline: (/** @type {any} */ criteria) =>
            store.latestDone({...criteria, branch: criteria.baseBranch || criteria.branch}),
        }),
        aborted,
      ]);
      await store.updateRun(run.id, {status: 'done', result, finishedAt: new Date()});
      await dispatch(run, result);
    } catch (err) {
      await store.updateRun(run.id, {
        status: 'failed',
        error: /** @type {Error} */ (err).message,
        finishedAt: new Date(),
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const queue = createQueue({
    maxQueued: limits.maxQueued,
    concurrency: limits.concurrency,
    execute,
  });

  /**
   * @param {any} entry
   * @return {Promise<void>} Never rejects: a failed log write must not fail the delivery.
   */
  const log = entry => store.addLog(entry).catch(() => {});

  /**
   * Creates the run row and queues it. @return {Promise<{ok: true, run: any} | {ok: false}>}
   * @param {any} fields
   */
  async function enqueue(fields) {
    if (queue.size() >= (limits.maxQueued || 20) + (limits.concurrency || 1)) return {ok: false};
    const run = await store.createRun(fields);
    if (!queue.push({runId: run.id, projectId: fields.projectId})) {
      await store.updateRun(run.id, {
        status: 'failed',
        error: 'queue full',
        finishedAt: new Date(),
      });
      return {ok: false};
    }
    return {ok: true, run};
  }

  // ---- webhooks ----
  const webhooks = express.Router(); // eslint-disable-line new-cap
  webhooks.post(
    '/:projectId',
    express.json({
      limit: '1mb',
      type: 'application/json',
      verify: (req, _res, buf) => {
        /** @type {any} */ (req).rawBody = buf;
      },
    }),
    handleAsyncError(async (req, res) => {
      const projectId = req.params.projectId;
      if (!UUID_PATTERN.test(projectId)) return res.status(404).json({message: 'not found'});
      const seo = await store.getProject(projectId);
      if (!seo) return res.status(404).json({message: 'not found'});
      if (!(await context.storageMethod.findProjectById(projectId))) {
        await store.deleteProject(projectId);
        return res.status(404).json({message: 'not found'});
      }

      if (seo.secretUnreadable) {
        // Never verify against a guess: without the right key no delivery can be trusted.
        return res
          .status(503)
          .json({message: "this project's secrets cannot be read; check LHCI_SEO_SECRET_KEY"});
      }

      const rawBody = /** @type {any} */ (req).rawBody;
      if (!rawBody) return res.status(415).json({message: 'send the webhook as application/json'});

      const eventName = EVENT_HEADERS[/** @type {'github'} */ (seo.provider)];
      const event = eventName ? String(req.header(eventName) || '') : 'lhci';
      const base = {projectId, provider: seo.provider, event};

      const verdict = deps.verifyWebhook({
        provider: seo.provider,
        headers: req.headers,
        rawBody,
        secret: seo.webhookSecret,
      });
      if (!verdict.ok) {
        if (rejectedLogLimiter.take(projectId)) {
          await log({...base, outcome: 'rejected', reason: verdict.reason});
        }
        return res.status(401).json({message: 'unauthorized'});
      }
      if (verdict.replayKey && replay.seen(`${projectId}:${verdict.replayKey}`)) {
        await log({...base, outcome: 'duplicate', reason: 'delivery already handled'});
        return res.status(200).json({status: 'duplicate'});
      }

      const outcome = deps.normalizeWebhook({provider: seo.provider, event, body: req.body});
      if (outcome.kind === 'ignore') {
        await log({...base, outcome: 'ignored', reason: outcome.reason});
        return res.status(200).json({status: 'ignored', reason: outcome.reason});
      }
      if (outcome.kind === 'invalid') {
        await log({...base, outcome: 'invalid', reason: outcome.reason});
        return res.status(400).json({message: outcome.reason});
      }

      const request = outcome.request;
      const target = request.url || seo.defaultUrl;
      if (!target) {
        await log({...base, outcome: 'invalid', reason: 'no url in the event and no default url'});
        return res
          .status(422)
          .json({message: 'no url to audit; set a default url for the project'});
      }
      const checked = deps.checkAuditUrl(target, parseJson(seo.allowedHosts, []));
      if (!checked.ok) {
        await log({...base, outcome: 'rejected', reason: checked.reason});
        return res.status(422).json({message: checked.reason});
      }

      if (!limiter.take(projectId)) {
        await log({...base, outcome: 'rate-limited', reason: 'too many deliveries'});
        res.set('Retry-After', '600');
        return res.status(429).json({message: 'too many deliveries; try again later'});
      }
      const queued = await enqueue({...request, trigger: 'webhook', projectId, url: checked.url});
      if (!queued.ok) {
        await log({...base, outcome: 'queue-full', reason: 'the audit queue is full'});
        res.set('Retry-After', '60');
        return res.status(503).json({message: 'the audit queue is full; try again later'});
      }
      await log({...base, outcome: 'accepted', runId: queued.run.id});
      store.pruneIfDue().catch(() => {});
      return res.status(202).json({status: 'queued', runId: queued.run.id});
    })
  );
  // eslint-disable-next-line no-unused-vars
  // Express recognises an error handler by its four parameters, so the unused ones must stay.
  /* eslint-disable no-unused-vars */
  webhooks.use(
    (
      /** @type {any} */ err,
      /** @type {any} */ _req,
      /** @type {any} */ res,
      /** @type {any} */ next
    ) => {
      if (err && err.type === 'entity.too.large') {
        return res.status(413).json({message: 'body too large'});
      }
      if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({message: 'body is not valid JSON'});
      }
      return res.status(500).json({message: 'internal error'});
    }
  );
  /* eslint-enable no-unused-vars */

  // ---- management ----
  const management = express.Router(); // eslint-disable-line new-cap
  const admin = validateAdminTokenMiddleware(context);
  const limitOf = (/** @type {any} */ req) => Number(req.query.limit) || 50;

  management.get(
    '/projects/:projectId/config',
    admin,
    handleAsyncError(async (req, res) => {
      const seo = await store.getProject(req.params.projectId);
      if (!seo) {
        return res.status(404).json({message: 'the SEO service is not set up for this project'});
      }
      return res.json(publicProject(seo));
    })
  );

  // What the settings form offers (presets, categories, audits) and what the saved settings come to, audit by audit.
  management.get(
    '/projects/:projectId/meta',
    admin,
    handleAsyncError(async (req, res) => {
      if (!deps.describeProject) {
        return res.status(501).json({message: 'not available on this server'});
      }
      const seo = await store.getProject(req.params.projectId);
      return res.json(deps.describeProject(seo ? parseJson(seo.config, {}) : {}));
    })
  );

  management.put(
    '/projects/:projectId/config',
    admin,
    handleAsyncError(async (req, res) => {
      const projectId = req.params.projectId;
      const body =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const existing = await store.getProject(projectId);
      /** @type {string[]} */
      const problems = [];

      if (body.provider !== undefined && !PROVIDERS.includes(body.provider)) {
        problems.push(`provider must be one of ${PROVIDERS.join(', ')}`);
      }
      if (!existing && body.provider === undefined) problems.push('provider is required');
      if (!existing && body.allowedHosts === undefined) problems.push('allowedHosts is required');
      if (body.allowedHosts !== undefined) {
        problems.push(...deps.validateAllowList(body.allowedHosts));
      }
      if (body.config !== undefined) {
        problems.push(...deps.validateConfig(body.config));
        if (JSON.stringify(body.config || {}).length > 20000) problems.push('config is too large');
      }
      const hosts =
        body.allowedHosts !== undefined
          ? body.allowedHosts
          : parseJson(existing && existing.allowedHosts, []);
      if (body.defaultUrl) {
        const check = deps.checkAuditUrl(body.defaultUrl, Array.isArray(hosts) ? hosts : []);
        if (!check.ok) problems.push(`defaultUrl: ${check.reason}`);
      }
      if (problems.length) return res.status(422).json({message: 'invalid settings', problems});

      const {project, secret} = await store.saveProject(projectId, {
        provider: body.provider,
        config: body.config,
        allowedHosts: body.allowedHosts,
        defaultUrl: body.defaultUrl === undefined ? undefined : body.defaultUrl || null,
      });
      return res
        .status(existing ? 200 : 201)
        .json({...publicProject(project), ...(secret && {webhookSecret: secret})});
    })
  );

  management.post(
    '/projects/:projectId/rotate-secret',
    admin,
    handleAsyncError(async (req, res) => {
      if (!(await store.getProject(req.params.projectId))) {
        return res.status(404).json({message: 'not set up'});
      }
      const {project, secret} = await store.saveProject(req.params.projectId, {}, {rotate: true});
      return res.json({...publicProject(project), webhookSecret: secret});
    })
  );

  // Where results go. Secrets (tokens, webhook URLs) go in and are never shown again: only which destinations are set up.
  management.get(
    '/projects/:projectId/notifications',
    admin,
    handleAsyncError(async (req, res) => {
      if (!(await store.getProject(req.params.projectId))) {
        return res.status(404).json({message: 'not set up'});
      }
      return res.json(
        deps.publicNotifications
          ? deps.publicNotifications(await store.getNotifications(req.params.projectId))
          : {}
      );
    })
  );

  management.put(
    '/projects/:projectId/notifications',
    admin,
    handleAsyncError(async (req, res) => {
      const projectId = req.params.projectId;
      if (!deps.validateNotifications || !deps.mergeNotifications || !deps.publicNotifications) {
        return res.status(501).json({message: 'notifications are not available on this server'});
      }
      if (!(await store.getProject(projectId))) {
        return res.status(404).json({message: 'not set up'});
      }
      const patch =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
      if (!patch) {
        return res
          .status(422)
          .json({message: 'invalid settings', problems: ['send a JSON object']});
      }
      const problems = deps.validateNotifications(patch);
      if (problems.length) return res.status(422).json({message: 'invalid settings', problems});
      const merged = deps.mergeNotifications(await store.getNotifications(projectId), patch);
      // The merged result is checked too, not only the patch.
      const after = deps.validateNotifications(merged);
      if (after.length) return res.status(422).json({message: 'invalid settings', problems: after});
      await store.saveNotifications(projectId, merged);
      return res.json(deps.publicNotifications(merged));
    })
  );

  management.delete(
    '/projects/:projectId/config',
    admin,
    handleAsyncError(async (req, res) => {
      await store.deleteProject(req.params.projectId);
      return res.sendStatus(204);
    })
  );

  management.get(
    '/projects/:projectId/runs',
    admin,
    handleAsyncError(async (req, res) =>
      res.json(await store.listRuns(req.params.projectId, limitOf(req)))
    )
  );

  management.get(
    '/projects/:projectId/runs/:runId',
    admin,
    handleAsyncError(async (req, res) => {
      const run = await store.getRun(req.params.runId);
      if (!run || run.projectId !== req.params.projectId) {
        return res.status(404).json({message: 'not found'});
      }
      return res.json({...run, result: parseJson(run.result, null)});
    })
  );

  management.get(
    '/projects/:projectId/webhook-logs',
    admin,
    handleAsyncError(async (req, res) =>
      res.json(await store.listLogs(req.params.projectId, limitOf(req)))
    )
  );

  // On-demand run: the admin token is the proof; the project's host allow-list still applies when it has one.
  management.post(
    '/projects/:projectId/runs',
    admin,
    handleAsyncError(async (req, res) => {
      const projectId = req.params.projectId;
      const seo = await store.getProject(projectId);
      if (!seo) {
        return res.status(404).json({message: 'the SEO service is not set up for this project'});
      }
      const url = req.body && req.body.url;
      const checked = deps.checkAuditUrl(url, parseJson(seo.allowedHosts, []));
      if (!checked.ok) return res.status(422).json({message: checked.reason});
      if (!limiter.take(projectId)) {
        res.set('Retry-After', '600');
        return res.status(429).json({message: 'too many runs; try again later'});
      }
      const queued = await enqueue({trigger: 'manual', projectId, url: checked.url});
      if (!queued.ok) {
        res.set('Retry-After', '60');
        return res.status(503).json({message: 'the audit queue is full; try again later'});
      }
      return res.status(202).json({status: 'queued', runId: queued.run.id});
    })
  );

  return {webhooks, management, store, queue};
}

module.exports = {createSeoService};
