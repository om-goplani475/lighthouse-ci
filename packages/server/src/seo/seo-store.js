/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Database tables of the SEO webhook service. Kept apart from the upstream tables and migrations: they are created with
 * `sync()` (create-if-missing) on the server's own connection, so no upstream file needs a migration.
 *
 * - `seo_projects`: one row per LHCI project that uses the service (the LHCI project id is the key). Holds the webhook
 *   secret, which must be readable (an HMAC cannot be checked against a hash); it is never sent out except once, when it
 *   is created or rotated. Same exposure as the build `token` the upstream `projects` table already stores in clear.
 * - `seo_notifications`: where a project's results go (GitHub/GitLab token, Slack/Teams webhook URL). Secrets, stored like
 *   the webhook secret and never returned by the API.
 * - `seo_runs`: one row per queued audit.
 * - `seo_webhook_logs`: one row per delivery, with the outcome. Never stores headers or bodies, so no secret or
 *   signature can end up in it.
 */
'use strict';

const crypto = require('crypto');
const Sequelize = require('sequelize');
const uuid = require('uuid');

/* eslint-disable new-cap */

const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RUN_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const MAX_LIST = 200;

/**
 * @param {unknown} value
 * @param {number} max
 * @return {string | null}
 */
function clip(value, max) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
async function createSeoStore(sequelize) {
  const Project = sequelize.define('seo_projects', {
    projectId: {type: Sequelize.UUID(), primaryKey: true},
    provider: {type: Sequelize.STRING(10), allowNull: false},
    webhookSecret: {type: Sequelize.STRING(128), allowNull: false},
    config: {type: Sequelize.TEXT()},
    allowedHosts: {type: Sequelize.TEXT()},
    defaultUrl: {type: Sequelize.STRING(2048)},
    createdAt: {type: Sequelize.DATE(6)},
    updatedAt: {type: Sequelize.DATE(6)},
  });
  const Notifications = sequelize.define('seo_notifications', {
    projectId: {type: Sequelize.UUID(), primaryKey: true},
    config: {type: Sequelize.TEXT()},
    createdAt: {type: Sequelize.DATE(6)},
    updatedAt: {type: Sequelize.DATE(6)},
  });
  const Run = sequelize.define(
    'seo_runs',
    {
      id: {type: Sequelize.UUID(), primaryKey: true},
      projectId: {type: Sequelize.UUID(), allowNull: false},
      status: {type: Sequelize.STRING(10), allowNull: false},
      trigger: {type: Sequelize.STRING(10), allowNull: false},
      provider: {type: Sequelize.STRING(10)},
      repo: {type: Sequelize.STRING(200)},
      sha: {type: Sequelize.STRING(64)},
      prNumber: {type: Sequelize.INTEGER()},
      branch: {type: Sequelize.STRING(255)},
      baseBranch: {type: Sequelize.STRING(255)},
      url: {type: Sequelize.STRING(2048), allowNull: false},
      // MySQL's plain TEXT holds 64 KB, too little for a report summary; SQLite ignores the size option and warns.
      result: {
        type: sequelize.getDialect() === 'mysql' ? Sequelize.TEXT('long') : Sequelize.TEXT(),
      },
      error: {type: Sequelize.STRING(500)},
      startedAt: {type: Sequelize.DATE(6)},
      finishedAt: {type: Sequelize.DATE(6)},
      createdAt: {type: Sequelize.DATE(6)},
      updatedAt: {type: Sequelize.DATE(6)},
    },
    {indexes: [{fields: ['projectId', 'createdAt']}]}
  );
  const Log = sequelize.define(
    'seo_webhook_logs',
    {
      id: {type: Sequelize.UUID(), primaryKey: true},
      projectId: {type: Sequelize.UUID()},
      provider: {type: Sequelize.STRING(10)},
      event: {type: Sequelize.STRING(60)},
      outcome: {type: Sequelize.STRING(16), allowNull: false},
      reason: {type: Sequelize.STRING(300)},
      runId: {type: Sequelize.UUID()},
      createdAt: {type: Sequelize.DATE(6)},
      updatedAt: {type: Sequelize.DATE(6)},
    },
    {indexes: [{fields: ['projectId', 'createdAt']}]}
  );

  await Promise.all([Project.sync(), Notifications.sync(), Run.sync(), Log.sync()]);

  let lastPrune = 0;

  return {
    /** @param {string} projectId @return {Promise<any>} */
    async getProject(projectId) {
      const row = await Project.findByPk(projectId);
      return row ? row.toJSON() : null;
    },

    /**
     * Creates or updates a project's settings. A secret is generated only when the project is new or `rotate` is set.
     * @param {string} projectId
     * @param {{provider?: string, config?: unknown, allowedHosts?: string[], defaultUrl?: string | null}} fields
     * @param {{rotate?: boolean}} [options]
     * @return {Promise<{project: any, secret: string | null}>} `secret` is the new secret, or null when unchanged.
     */
    async saveProject(projectId, fields, options = {}) {
      const existing = await Project.findByPk(projectId);
      const secret = !existing || options.rotate ? crypto.randomBytes(32).toString('hex') : null;
      const values = {
        ...(fields.provider !== undefined && {provider: fields.provider}),
        ...(fields.config !== undefined && {config: JSON.stringify(fields.config || {})}),
        ...(fields.allowedHosts !== undefined && {
          allowedHosts: JSON.stringify(fields.allowedHosts),
        }),
        ...(fields.defaultUrl !== undefined && {defaultUrl: fields.defaultUrl}),
        ...(secret && {webhookSecret: secret}),
      };
      if (existing) await existing.update(values);
      else await Project.create({projectId, ...values});
      const saved = await Project.findByPk(projectId);
      return {project: saved ? saved.toJSON() : null, secret};
    },

    /** @param {string} projectId */
    async deleteProject(projectId) {
      await Project.destroy({where: {projectId}});
      await Notifications.destroy({where: {projectId}});
    },

    /** @param {string} projectId @return {Promise<any | null>} */
    async getNotifications(projectId) {
      const row = await Notifications.findByPk(projectId);
      if (!row) return null;
      try {
        return JSON.parse(row.toJSON().config) || null;
      } catch (_) {
        return null;
      }
    },

    /** @param {string} projectId @param {any} config */
    async saveNotifications(projectId, config) {
      const text = JSON.stringify(config || {});
      const existing = await Notifications.findByPk(projectId);
      if (existing) await existing.update({config: text});
      else await Notifications.create({projectId, config: text});
    },

    /** @param {any} fields @return {Promise<any>} */
    async createRun(fields) {
      const row = await Run.create({
        id: uuid.v4(),
        status: 'queued',
        trigger: fields.trigger,
        projectId: fields.projectId,
        provider: clip(fields.provider, 10),
        repo: clip(fields.repo, 200),
        sha: clip(fields.sha, 64),
        prNumber: fields.prNumber === undefined ? null : fields.prNumber,
        branch: clip(fields.branch, 255),
        baseBranch: clip(fields.baseBranch, 255),
        url: clip(fields.url, 2048),
      });
      return row.toJSON();
    },

    /** @param {string} id @param {any} patch */
    async updateRun(id, patch) {
      const values = {...patch};
      if (values.error !== undefined) values.error = clip(values.error, 500);
      if (values.result !== undefined && typeof values.result !== 'string') {
        values.result = JSON.stringify(values.result);
      }
      await Run.update(values, {where: {id}});
    },

    /** @param {string} id @return {Promise<any>} */
    async getRun(id) {
      const row = await Run.findByPk(id);
      return row ? row.toJSON() : null;
    },

    /** @param {string} projectId @param {number} [limit] @return {Promise<any[]>} Newest first, without the result body. */
    async listRuns(projectId, limit = 50) {
      const rows = await Run.findAll({
        where: {projectId},
        attributes: {exclude: ['result']},
        order: [['createdAt', 'DESC']],
        limit: Math.min(Math.max(1, limit | 0), MAX_LIST),
      });
      return rows.map(r => r.toJSON());
    },

    /**
     * The latest finished run of the same page on a branch, for comparing a new run against. Preview hosts change per
     * pull request, so the page is matched by path, not by host.
     * @param {{projectId: string, branch: string | null, url: string, excludeRunId?: string}} criteria
     * @return {Promise<{id: string, summary: any, signals: any} | null>}
     */
    async latestDone({projectId, branch, url, excludeRunId}) {
      const pathOf = (/** @type {string} */ u) => {
        try {
          return new URL(u).pathname.replace(/(.)\/+$/, '$1');
        } catch (_) {
          return null;
        }
      };
      const wanted = pathOf(url);
      if (wanted === null) return null;
      const where = {
        projectId,
        status: 'done',
        branch: branch || null,
        ...(excludeRunId && {id: {[Sequelize.Op.ne]: excludeRunId}}),
      };
      const rows = await Run.findAll({where, order: [['createdAt', 'DESC']], limit: 50});
      for (const row of rows) {
        const run = row.toJSON();
        if (pathOf(run.url) !== wanted) continue;
        try {
          const result = JSON.parse(run.result);
          if (result && result.summary) {
            return {id: run.id, summary: result.summary, signals: result.signals || null};
          }
        } catch (_) {
          // an unreadable result is skipped; the next older run may be fine
        }
      }
      return null;
    },

    /**
     * Runs left `queued` or `running` by a server that stopped: the in-memory queue is gone, so they can never finish.
     * @return {Promise<number>} How many were closed.
     */
    async failOrphans() {
      const [count] = await Run.update(
        {
          status: 'failed',
          error: 'the server restarted before this run finished',
          finishedAt: new Date(),
        },
        {where: {status: {[Sequelize.Op.in]: ['queued', 'running']}}}
      );
      return count;
    },

    /** @param {{projectId?: string | null, provider?: string | null, event?: string | null, outcome: string, reason?: string | null, runId?: string | null}} entry */
    async addLog(entry) {
      await Log.create({
        id: uuid.v4(),
        projectId: entry.projectId || null,
        provider: clip(entry.provider, 10),
        event: clip(entry.event, 60),
        outcome: clip(entry.outcome, 16),
        reason: clip(entry.reason, 300),
        runId: entry.runId || null,
      });
    },

    /** @param {string} projectId @param {number} [limit] @return {Promise<any[]>} */
    async listLogs(projectId, limit = 50) {
      const rows = await Log.findAll({
        where: {projectId},
        order: [['createdAt', 'DESC']],
        limit: Math.min(Math.max(1, limit | 0), MAX_LIST),
      });
      return rows.map(r => r.toJSON());
    },

    /**
     * Deletes old logs and runs, at most once an hour (called on every accepted delivery, so no timer is needed).
     * @param {number} [now]
     */
    async pruneIfDue(now = Date.now()) {
      if (now - lastPrune < PRUNE_EVERY_MS) return;
      lastPrune = now;
      const before = (/** @type {number} */ ms) => ({[Sequelize.Op.lt]: new Date(now - ms)});
      await Log.destroy({where: {createdAt: before(LOG_RETENTION_MS)}});
      await Run.destroy({where: {createdAt: before(RUN_RETENTION_MS)}});
    },
  };
}

module.exports = {createSeoStore};
