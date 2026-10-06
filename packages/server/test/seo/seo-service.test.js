/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/* eslint-env jest */
/* global fetch */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const StorageMethod = require('../../src/api/storage/storage-method.js');
const {createSeoService} = require('../../src/seo/seo-routes.js');
const {createServer} = require('../../src/server.js');
const {loadSeoDeps} = require('../../src/seo/load-deps.js');
const {hmacHex} = require('../../../seo-audits/src/service/webhook-signature.js');

const SHA = 'a'.repeat(40);
const GOOD_URL = 'https://pr-1.stage.example.org/';

/** @param {string} dbPath */
async function openStorage(dbPath) {
  const storage = {storageMethod: 'sql', sqlDialect: 'sqlite', sqlDatabasePath: dbPath};
  const storageMethod = StorageMethod.from(storage);
  await storageMethod.initialize(storage);
  return storageMethod;
}

/** Calls the app over real HTTP. @param {number} port */
function client(port) {
  const call = async (method, urlPath, {body, headers = {}, raw} = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: {
        ...(raw === undefined && body !== undefined ? {'content-type': 'application/json'} : {}),
        ...headers,
      },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = undefined;
    }
    return {status: res.status, json, text, headers: res.headers};
  };
  return {
    get: (p, headers) => call('GET', p, {headers}),
    post: (p, body, headers, raw) => call('POST', p, {body, headers, raw}),
    put: (p, body, headers) => call('PUT', p, {body, headers}),
    del: (p, headers) => call('DELETE', p, {headers}),
  };
}

/** Signs an `lhci` delivery. @return {Record<string, string>} */
function signLhci(secret, body, now = Date.now()) {
  const stamp = String(Math.floor(now / 1000));
  return {
    'content-type': 'application/json',
    'x-lhci-timestamp': stamp,
    'x-lhci-signature': `sha256=${hmacHex(secret, `${stamp}.${body}`)}`,
  };
}

const eventBody = (extra = {}) =>
  JSON.stringify({
    repo: 'acme/site',
    sha: SHA,
    url: GOOD_URL,
    prNumber: 4,
    branch: 'f',
    baseBranch: 'main',
    ...extra,
  });

/** @param {Record<string, any>} limits @param {(input: any) => Promise<unknown>} [runAudit] */
async function startService(limits, runAudit, send) {
  const dbPath = path.join(
    os.tmpdir(),
    `seo-service-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const storageMethod = await openStorage(dbPath);
  // Never the real runner (it would start Chrome): a test gets the fake it passes, or no runner at all.
  // Nor the real sender: nothing in a test may leave the machine.
  const sent = [];
  const deps = {
    ...(await loadSeoDeps()),
    runAudit,
    send:
      send ||
      (async request => {
        sent.push(request);
        return {status: 200, headers: {}, json: [], text: ''};
      }),
  };
  const service = await createSeoService({storageMethod}, deps, limits);
  const app = express();
  app.use('/api/v1/webhooks', service.webhooks);
  app.use(express.json());
  app.use('/api/v1/seo', service.management);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const project = await storageMethod.createProject({
    name: 'proj-p',
    externalUrl: '',
    baseBranch: 'main',
    slug: '',
    token: '',
    adminToken: '',
  });
  const other = await storageMethod.createProject({
    name: 'proj-q',
    externalUrl: '',
    baseBranch: 'main',
    slug: '',
    token: '',
    adminToken: '',
  });
  const api = client(port);
  const admin = {'x-lhci-admin-token': project.adminToken};
  const base = `/api/v1/seo/projects/${project.id}`;
  return {
    sent,
    api,
    admin,
    base,
    project,
    other,
    storageMethod,
    service,
    deps,
    dbPath,
    hook: `/api/v1/webhooks/${project.id}`,
    /** Sets the project up with the lhci provider and returns its secret. */
    async setUp(extra = {}) {
      const res = await api.put(
        `${base}/config`,
        {provider: 'lhci', allowedHosts: ['*.stage.example.org'], ...extra},
        admin
      );
      expect(res.status).toBe(201);
      return res.json.webhookSecret;
    },
    async stop() {
      await new Promise(r => server.close(r));
      await storageMethod.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    },
  };
}

describe('SEO webhook service', () => {
  /** @type {Awaited<ReturnType<typeof startService>>} */
  let t;
  afterEach(async () => {
    if (t) await t.stop();
  });

  describe('management', () => {
    it('needs the project admin token', async () => {
      t = await startService({});
      expect((await t.api.get(`${t.base}/config`)).status).toBe(403);
      expect(
        (await t.api.put(`${t.base}/config`, {provider: 'lhci'}, {'x-lhci-admin-token': 'wrong'}))
          .status
      ).toBe(403);
      // another project's admin token does not open this project
      expect(
        (await t.api.get(`${t.base}/config`, {'x-lhci-admin-token': t.other.adminToken})).status
      ).toBe(403);
    });

    it('creates settings, shows the secret once, and never returns it again', async () => {
      t = await startService({});
      const created = await t.api.put(
        `${t.base}/config`,
        {
          provider: 'github',
          preset: 'ecommerce',
          allowedHosts: ['*.stage.example.org'],
          defaultUrl: GOOD_URL,
        },
        t.admin
      );
      expect(created.status).toBe(201);
      expect(created.json.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(created.json.webhookPath).toBe(`/api/v1/webhooks/${t.project.id}`);

      const read = await t.api.get(`${t.base}/config`, t.admin);
      expect(read.status).toBe(200);
      expect(read.text).not.toContain(created.json.webhookSecret);
      expect(read.json).toMatchObject({
        provider: 'github',
        allowedHosts: ['*.stage.example.org'],
        defaultUrl: GOOD_URL,
      });

      const updated = await t.api.put(`${t.base}/config`, {config: {preset: 'blog'}}, t.admin);
      expect(updated.status).toBe(200);
      expect(updated.json.webhookSecret).toBeUndefined();
      expect(updated.json.config).toEqual({preset: 'blog'});
    });

    it('lists every problem with a bad config, and stores nothing', async () => {
      t = await startService({});
      const res = await t.api.put(
        `${t.base}/config`,
        {
          provider: 'svn',
          config: {preset: 'nope'},
          allowedHosts: [],
          defaultUrl: 'https://evil.net/',
        },
        t.admin
      );
      expect(res.status).toBe(422);
      expect(res.json.problems.join('|')).toMatch(/provider must be one of/);
      expect(res.json.problems.join('|')).toMatch(/unknown preset "nope"/);
      expect(res.json.problems.join('|')).toMatch(/at least one host/);
      expect((await t.api.get(`${t.base}/config`, t.admin)).status).toBe(404);
    });

    it('requires a provider and an allow-list when first set up', async () => {
      t = await startService({});
      const res = await t.api.put(`${t.base}/config`, {}, t.admin);
      expect(res.json.problems).toEqual(
        expect.arrayContaining(['provider is required', 'allowedHosts is required'])
      );
    });

    it('rotating the secret invalidates the old one', async () => {
      t = await startService({});
      const oldSecret = await t.setUp({defaultUrl: GOOD_URL});
      const rotated = await t.api.post(`${t.base}/rotate-secret`, undefined, t.admin);
      expect(rotated.json.webhookSecret).not.toBe(oldSecret);
      const body = eventBody();
      expect((await t.api.post(t.hook, undefined, signLhci(oldSecret, body), body)).status).toBe(
        401
      );
      expect(
        (await t.api.post(t.hook, undefined, signLhci(rotated.json.webhookSecret, body), body))
          .status
      ).toBe(202);
    });
  });

  describe('webhook intake', () => {
    it('accepts a signed delivery, runs it, and records the result and the log', async () => {
      const seen = [];
      t = await startService({}, async input => {
        seen.push(input);
        return {score: 91};
      });
      const secret = await t.setUp();
      const body = eventBody();
      const res = await t.api.post(t.hook, undefined, signLhci(secret, body), body);
      expect(res.status).toBe(202);
      await t.service.queue.idle();

      const run = await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin);
      expect(run.json).toMatchObject({
        status: 'done',
        trigger: 'webhook',
        repo: 'acme/site',
        sha: SHA,
        prNumber: 4,
        url: GOOD_URL,
        result: {score: 91},
      });
      expect(seen[0].allowedHosts).toEqual(['*.stage.example.org']);
      expect(seen[0].signal).toBeDefined();

      const logs = (await t.api.get(`${t.base}/webhook-logs`, t.admin)).json;
      expect(logs[0]).toMatchObject({outcome: 'accepted', runId: res.json.runId});
      const list = (await t.api.get(`${t.base}/runs`, t.admin)).json;
      expect(list[0].result).toBeUndefined();
    });

    it('rejects a bad signature, never says why, and logs it without any secret or header', async () => {
      t = await startService({});
      const secret = await t.setUp();
      const body = eventBody();
      const headers = signLhci('not-the-secret', body);
      const res = await t.api.post(t.hook, undefined, headers, body);
      expect(res.status).toBe(401);
      expect(res.json).toEqual({message: 'unauthorized'});
      const dump = JSON.stringify((await t.api.get(`${t.base}/webhook-logs`, t.admin)).json);
      expect(dump).toMatch(/rejected/);
      expect(dump).not.toContain(secret);
      expect(dump).not.toContain(headers['x-lhci-signature']);
      expect((await t.api.get(`${t.base}/runs`, t.admin)).json).toEqual([]);
    });

    it('answers unknown, malformed or removed projects with 404', async () => {
      t = await startService({});
      expect((await t.api.post('/api/v1/webhooks/not-a-uuid', {})).status).toBe(404);
      expect(
        (await t.api.post('/api/v1/webhooks/11111111-1111-4111-8111-111111111111', {})).status
      ).toBe(404);
      const secret = await t.setUp();
      await t.storageMethod.deleteProject(t.project.id);
      const body = eventBody();
      expect((await t.api.post(t.hook, undefined, signLhci(secret, body), body)).status).toBe(404);
      expect(await t.service.store.getProject(t.project.id)).toBeNull();
    });

    it('rejects a non-JSON content type, bad JSON and an oversize body', async () => {
      t = await startService({});
      const secret = await t.setUp();
      expect(
        (await t.api.post(t.hook, undefined, {'content-type': 'text/plain'}, 'x')).status
      ).toBe(415);
      const bad = '{nope';
      expect((await t.api.post(t.hook, undefined, signLhci(secret, bad), bad)).status).toBe(400);
      const big = JSON.stringify({pad: 'x'.repeat(1.1 * 1024 * 1024)});
      expect((await t.api.post(t.hook, undefined, signLhci(secret, big), big)).status).toBe(413);
    });

    it('refuses a host that is not on the allow-list, before anything is queued', async () => {
      t = await startService({});
      const secret = await t.setUp();
      for (const url of [
        'https://evil.net/',
        'http://127.0.0.1/',
        'https://stage.example.org/',
        'https://x.stage.example.org.evil.net/',
      ]) {
        const body = eventBody({url});
        const res = await t.api.post(t.hook, undefined, signLhci(secret, body), body);
        expect(res.status).toBe(422);
      }
      expect((await t.api.get(`${t.base}/runs`, t.admin)).json).toEqual([]);
      expect((await t.api.get(`${t.base}/webhook-logs`, t.admin)).json[0].outcome).toBe('rejected');
    });

    it('uses the default url when the event has none, and says so when there is neither', async () => {
      t = await startService({}, async () => ({}));
      const secret = await t.setUp();
      const noUrl = eventBody({url: undefined});
      expect((await t.api.post(t.hook, undefined, signLhci(secret, noUrl), noUrl)).status).toBe(
        422
      );
      await t.api.put(`${t.base}/config`, {defaultUrl: GOOD_URL}, t.admin);
      const res = await t.api.post(
        t.hook,
        undefined,
        signLhci(secret, noUrl, Date.now() + 1000),
        noUrl
      );
      expect(res.status).toBe(202);
      await t.service.queue.idle();
      expect((await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin)).json.url).toBe(
        GOOD_URL
      );
    });

    it('answers a repeated delivery with "duplicate" and queues it once', async () => {
      t = await startService({}, async () => ({}));
      const secret = await t.setUp();
      const body = eventBody();
      const headers = signLhci(secret, body);
      expect((await t.api.post(t.hook, undefined, headers, body)).status).toBe(202);
      const again = await t.api.post(t.hook, undefined, headers, body);
      expect(again.status).toBe(200);
      expect(again.json.status).toBe('duplicate');
      await t.service.queue.idle();
      expect((await t.api.get(`${t.base}/runs`, t.admin)).json).toHaveLength(1);
    });

    it('verifies GitHub deliveries and ignores events that are not audited', async () => {
      t = await startService({}, async () => ({}));
      const created = await t.api.put(
        `${t.base}/config`,
        {provider: 'github', allowedHosts: ['*.stage.example.org'], defaultUrl: GOOD_URL},
        t.admin
      );
      const secret = created.json.webhookSecret;
      const send = (event, payload, delivery) => {
        const raw = JSON.stringify(payload);
        return t.api.post(
          t.hook,
          undefined,
          {
            'content-type': 'application/json',
            'x-github-event': event,
            'x-github-delivery': delivery,
            'x-hub-signature-256': `sha256=${hmacHex(secret, raw)}`,
          },
          raw
        );
      };
      const pr = {
        action: 'opened',
        number: 9,
        repository: {full_name: 'acme/site'},
        pull_request: {draft: false, head: {sha: SHA, ref: 'f'}, base: {ref: 'main'}},
      };
      const queued = await send('pull_request', pr, 'd1');
      expect(queued.status).toBe(202);
      expect((await send('ping', {zen: 'x'}, 'd2')).json.status).toBe('ignored');
      expect((await send('pull_request', {...pr, action: 'closed'}, 'd3')).json.status).toBe(
        'ignored'
      );
      await t.service.queue.idle();
      const run = (await t.api.get(`${t.base}/runs/${queued.json.runId}`, t.admin)).json;
      expect(run).toMatchObject({prNumber: 9, url: GOOD_URL, provider: 'github'});
      // a body that was signed for a different payload is refused
      const raw = JSON.stringify(pr);
      const forged = await t.api.post(
        t.hook,
        undefined,
        {
          'content-type': 'application/json',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': `sha256=${hmacHex(secret, raw + ' ')}`,
        },
        raw
      );
      expect(forged.status).toBe(401);
    });
  });

  describe('limits', () => {
    it('limits deliveries per project', async () => {
      t = await startService({rateMax: 2}, async () => ({}));
      const secret = await t.setUp();
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        const body = eventBody({sha: String(i).repeat(40)});
        statuses.push(
          (await t.api.post(t.hook, undefined, signLhci(secret, body, Date.now() + i * 1000), body))
            .status
        );
      }
      expect(statuses).toEqual([202, 202, 429]);
    });

    it('answers 503 when the queue is full, and recovers when it drains', async () => {
      let release;
      const gate = new Promise(r => (release = r));
      t = await startService({maxQueued: 1, concurrency: 1}, () => gate);
      const secret = await t.setUp();
      const send = async i => {
        const body = eventBody({sha: String(i).repeat(40)});
        return t.api.post(t.hook, undefined, signLhci(secret, body, Date.now() + i * 1000), body);
      };
      expect((await send(1)).status).toBe(202); // running
      expect((await send(2)).status).toBe(202); // queued
      const full = await send(3);
      expect(full.status).toBe(503);
      expect(full.headers.get('retry-after')).toBe('60');
      release({});
      await t.service.queue.idle();
      expect((await send(4)).status).toBe(202);
      release({});
      await t.service.queue.idle();
    });

    it('records a failing run and keeps serving', async () => {
      let calls = 0;
      t = await startService({}, async () => {
        calls++;
        if (calls === 1) throw new Error('chrome crashed');
        return {ok: true};
      });
      const secret = await t.setUp();
      const ids = [];
      for (let i = 1; i <= 2; i++) {
        const body = eventBody({sha: String(i).repeat(40)});
        ids.push(
          (await t.api.post(t.hook, undefined, signLhci(secret, body, Date.now() + i * 1000), body))
            .json.runId
        );
        await t.service.queue.idle();
      }
      expect((await t.api.get(`${t.base}/runs/${ids[0]}`, t.admin)).json).toMatchObject({
        status: 'failed',
        error: 'chrome crashed',
      });
      expect((await t.api.get(`${t.base}/runs/${ids[1]}`, t.admin)).json.status).toBe('done');
    });

    it('stops a run that takes too long', async () => {
      t = await startService({jobTimeoutMs: 50}, () => new Promise(() => {}));
      const secret = await t.setUp();
      const body = eventBody();
      const res = await t.api.post(t.hook, undefined, signLhci(secret, body), body);
      await t.service.queue.idle();
      expect((await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin)).json).toMatchObject({
        status: 'failed',
        error: 'the run took too long',
      });
    });

    it('fails a run honestly when no runner is installed', async () => {
      t = await startService({});
      const secret = await t.setUp();
      const body = eventBody();
      const res = await t.api.post(t.hook, undefined, signLhci(secret, body), body);
      await t.service.queue.idle();
      expect((await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin)).json.error).toMatch(
        /runner is not installed/
      );
    });

    it('closes runs a restarted server left unfinished', async () => {
      t = await startService({});
      await t.setUp();
      const run = await t.service.store.createRun({
        trigger: 'webhook',
        projectId: t.project.id,
        url: GOOD_URL,
      });
      expect(await t.service.store.failOrphans()).toBe(1);
      expect((await t.service.store.getRun(run.id)).status).toBe('failed');
    });
  });

  describe('baseline lookup', () => {
    it('gives a run the latest finished run of the same path on the base branch, and ignores other paths and branches', async () => {
      const baselines = [];
      t = await startService({}, async input => {
        baselines.push(
          await input.findBaseline({
            projectId: input.run.projectId,
            branch: input.run.branch,
            baseBranch: input.run.baseBranch,
            url: input.run.url,
            excludeRunId: input.run.id,
          })
        );
        return {summary: {marker: input.run.sha[0]}};
      });
      const secret = await t.setUp();
      const send = async (n, extra) => {
        const body = eventBody({sha: String(n).repeat(40), ...extra});
        const res = await t.api.post(
          t.hook,
          undefined,
          signLhci(secret, body, Date.now() + n * 1000),
          body
        );
        await t.service.queue.idle();
        return res;
      };
      await send(1, {
        branch: 'main',
        baseBranch: undefined,
        url: 'https://main.stage.example.org/',
      });
      await send(2, {
        branch: 'main',
        baseBranch: undefined,
        url: 'https://main.stage.example.org/other',
      });
      await send(3, {branch: 'dev', baseBranch: undefined});
      // a pull request: compared with main, same path "/", different host
      await send(4, {branch: 'feat', baseBranch: 'main', url: 'https://pr-9.stage.example.org/'});
      // the next main run is compared with the previous main run, not with itself
      await send(5, {
        branch: 'main',
        baseBranch: undefined,
        url: 'https://main.stage.example.org/',
      });
      expect(baselines.map(b => (b ? b.summary.marker : null))).toEqual([
        null,
        null,
        null,
        '1',
        '1',
      ]);
    });

    it('does not use a failed run as a baseline', async () => {
      let calls = 0;
      t = await startService({}, async input => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return {
          summary: {
            n: calls,
            seen: await input.findBaseline({
              projectId: input.run.projectId,
              branch: 'main',
              baseBranch: null,
              url: input.run.url,
              excludeRunId: input.run.id,
            }),
          },
        };
      });
      const secret = await t.setUp();
      for (const n of [1, 2]) {
        const body = eventBody({sha: String(n).repeat(40), branch: 'main', baseBranch: undefined});
        const res = await t.api.post(
          t.hook,
          undefined,
          signLhci(secret, body, Date.now() + n * 1000),
          body
        );
        await t.service.queue.idle();
        if (n === 2) {
          expect(
            (await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin)).json.result.summary.seen
          ).toBeNull();
        }
      }
    });
  });

  describe('notifications and dispatch', () => {
    const TOKEN = 'ghp_supersecret_token_value';
    const HOOK = 'https://hooks.slack.com/services/T000/B000/SECRETPART';
    /** A fake GitHub/Slack: lists no comments, accepts a new one, accepts alerts. */
    const friendly = log => async request => {
      log.push(request);
      if (request.method === 'GET') return {status: 200, headers: {}, json: [], text: ''};
      return {status: request.url.includes('slack') ? 200 : 201, headers: {}, json: {}, text: ''};
    };
    const criticalResult = {
      summary: {overall: {score: 70, grade: 'C'}, categories: [], audits: []},
      comparison: {
        overallDelta: -5,
        categories: [],
        newIssues: [
          {
            id: 'canonical-https',
            title: 'Canonical',
            tier: 'error',
            status: 'fail',
            displayValue: 'x',
          },
        ],
        fixed: [],
        stillFailing: [],
      },
    };
    const logsOf = async t => (await t.api.get(`${t.base}/webhook-logs`, t.admin)).json;

    it('needs the admin token and a set-up project, and validates what it is given', async () => {
      t = await startService({});
      expect((await t.api.get(`${t.base}/notifications`, t.admin)).status).toBe(404);
      await t.setUp();
      expect((await t.api.put(`${t.base}/notifications`, {comment: false})).status).toBe(403);
      const bad = await t.api.put(
        `${t.base}/notifications`,
        {slack: {webhookUrl: 'https://evil.example.com/x'}, github: {token: 'a b'}, mystery: 1},
        t.admin
      );
      expect(bad.status).toBe(422);
      expect(bad.json.problems).toHaveLength(3);
      expect((await t.api.put(`${t.base}/notifications`, [1], t.admin)).status).toBe(422);
    });

    it('stores secrets, never shows them again, and a later patch keeps the stored token', async () => {
      t = await startService({});
      await t.setUp();
      const put = await t.api.put(
        `${t.base}/notifications`,
        {github: {token: TOKEN}, slack: {webhookUrl: HOOK}},
        t.admin
      );
      expect(put.status).toBe(200);
      for (const text of [put.text, (await t.api.get(`${t.base}/notifications`, t.admin)).text]) {
        for (const secret of [TOKEN, 'SECRETPART', 'T000']) expect(text).not.toContain(secret);
      }
      expect(put.json).toMatchObject({
        github: {tokenSet: true},
        slack: {webhookHost: 'hooks.slack.com'},
      });
      await t.api.put(
        `${t.base}/notifications`,
        {github: {apiBase: 'https://ghe.example.com'}, slack: null},
        t.admin
      );
      expect(await t.service.store.getNotifications(t.project.id)).toEqual({
        github: {token: TOKEN, apiBase: 'https://ghe.example.com'},
      });
    });

    it('comments on a github pull request using the stored token', async () => {
      const log = [];
      t = await startService(
        {},
        async () => ({
          url: GOOD_URL,
          summary: {overall: {score: 91, grade: 'A'}, categories: [], audits: []},
          comparison: null,
        }),
        friendly(log)
      );
      const created = await t.api.put(
        `${t.base}/config`,
        {provider: 'github', allowedHosts: ['*.stage.example.org'], defaultUrl: GOOD_URL},
        t.admin
      );
      await t.api.put(`${t.base}/notifications`, {github: {token: TOKEN}}, t.admin);
      const raw = JSON.stringify({
        action: 'opened',
        number: 5,
        repository: {full_name: 'acme/site'},
        pull_request: {draft: false, head: {sha: SHA, ref: 'f'}, base: {ref: 'main'}},
      });
      const res = await t.api.post(
        t.hook,
        undefined,
        {
          'content-type': 'application/json',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': `sha256=${hmacHex(created.json.webhookSecret, raw)}`,
        },
        raw
      );
      expect(res.status).toBe(202);
      await t.service.queue.idle();
      expect(log.map(r => r.method)).toEqual(['GET', 'POST']);
      expect(log[1].url).toBe('https://api.github.com/repos/acme/site/issues/5/comments');
      expect(log[1].body.body).toContain('SEO audit: 91.0 (A)');
      expect((await logsOf(t)).map(l => l.outcome)).toEqual(
        expect.arrayContaining(['accepted', 'comment-posted'])
      );
      expect((await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin)).json.status).toBe(
        'done'
      );
    });

    it('a sending failure is logged without the token and does not fail the run', async () => {
      t = await startService(
        {},
        async () => criticalResult,
        async () => ({status: 401, headers: {}, json: null, text: `bad credentials ${TOKEN}`})
      );
      const created = await t.api.put(
        `${t.base}/config`,
        {provider: 'github', allowedHosts: ['*.stage.example.org'], defaultUrl: GOOD_URL},
        t.admin
      );
      await t.api.put(`${t.base}/notifications`, {github: {token: TOKEN}}, t.admin);
      const raw = JSON.stringify({
        action: 'opened',
        number: 5,
        repository: {full_name: 'acme/site'},
        pull_request: {draft: false, head: {sha: SHA, ref: 'f'}, base: {ref: 'main'}},
      });
      const res = await t.api.post(
        t.hook,
        undefined,
        {
          'content-type': 'application/json',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': `sha256=${hmacHex(created.json.webhookSecret, raw)}`,
        },
        raw
      );
      await t.service.queue.idle();
      expect((await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin)).json.status).toBe(
        'done'
      );
      const logs = await logsOf(t);
      expect(logs.find(l => l.outcome === 'comment-failed').reason).toMatch(/GitHub answered 401/);
      expect(JSON.stringify(logs)).not.toContain(TOKEN);
    });

    it('sends a Slack alert for a new critical regression on a deployment, not for a pull request comment-only run', async () => {
      const log = [];
      t = await startService({}, async () => criticalResult, friendly(log));
      const secret = await t.setUp();
      await t.api.put(`${t.base}/notifications`, {slack: {webhookUrl: HOOK}}, t.admin);
      const body = eventBody({prNumber: undefined, branch: 'main', baseBranch: undefined});
      await t.api.post(t.hook, undefined, signLhci(secret, body), body);
      await t.service.queue.idle();
      expect(log).toHaveLength(1);
      expect(log[0].url).toBe(HOOK);
      expect(log[0].body.text).toContain('SEO regression');
      expect((await logsOf(t)).find(l => l.event === 'slack')).toMatchObject({
        outcome: 'alert-sent',
      });

      // a pull request run does not raise an alert by default
      const pr = eventBody({sha: 'd'.repeat(40), prNumber: 6});
      await t.api.post(t.hook, undefined, signLhci(secret, pr, Date.now() + 1000), pr);
      await t.service.queue.idle();
      expect(log).toHaveLength(1);
    });

    it('sends nothing when the project has no notifications set up, and removing the config removes them', async () => {
      t = await startService({}, async () => criticalResult);
      const secret = await t.setUp();
      const body = eventBody({prNumber: undefined});
      await t.api.post(t.hook, undefined, signLhci(secret, body), body);
      await t.service.queue.idle();
      expect(t.sent).toHaveLength(0);
      await t.api.put(`${t.base}/notifications`, {slack: {webhookUrl: HOOK}}, t.admin);
      await t.api.del(`${t.base}/config`, t.admin);
      expect(await t.service.store.getNotifications(t.project.id)).toBeNull();
    });
  });

  describe('on-demand runs and isolation', () => {
    it('runs a url on demand for the admin, within the allow-list', async () => {
      t = await startService({}, async () => ({ok: 1}));
      await t.setUp();
      expect((await t.api.post(`${t.base}/runs`, {url: GOOD_URL})).status).toBe(403);
      expect((await t.api.post(`${t.base}/runs`, {url: 'https://evil.net/'}, t.admin)).status).toBe(
        422
      );
      const res = await t.api.post(`${t.base}/runs`, {url: GOOD_URL}, t.admin);
      expect(res.status).toBe(202);
      await t.service.queue.idle();
      expect((await t.api.get(`${t.base}/runs/${res.json.runId}`, t.admin)).json).toMatchObject({
        status: 'done',
        trigger: 'manual',
      });
    });

    it("does not show one project's runs to another project's admin", async () => {
      t = await startService({}, async () => ({}));
      await t.setUp();
      const res = await t.api.post(`${t.base}/runs`, {url: GOOD_URL}, t.admin);
      await t.service.queue.idle();
      const otherAdmin = {'x-lhci-admin-token': t.other.adminToken};
      const otherBase = `/api/v1/seo/projects/${t.other.id}`;
      expect((await t.api.get(`${otherBase}/runs/${res.json.runId}`, otherAdmin)).status).toBe(404);
      expect((await t.api.get(`${otherBase}/runs`, otherAdmin)).json).toEqual([]);
    });
  });
});

describe('server wiring', () => {
  it('mounts the service in the real server: webhooks need a signature, management an admin token', async () => {
    const dbPath = path.join(os.tmpdir(), `seo-wiring-${process.pid}.sqlite`);
    const server = await createServer({
      logLevel: 'silent',
      port: 0,
      storage: {storageMethod: 'sql', sqlDialect: 'sqlite', sqlDatabasePath: dbPath},
    });
    try {
      const api = client(server.port);
      const project = await server.storageMethod.createProject({
        name: 'proj-w',
        externalUrl: '',
        baseBranch: 'main',
        slug: '',
        token: '',
        adminToken: '',
      });
      expect((await api.post(`/api/v1/webhooks/${project.id}`, {})).status).toBe(404);
      expect((await api.get(`/api/v1/seo/projects/${project.id}/config`)).status).toBe(403);
      const admin = {'x-lhci-admin-token': project.adminToken};
      const created = await api.put(
        `/api/v1/seo/projects/${project.id}/config`,
        {provider: 'lhci', allowedHosts: ['*.stage.example.org']},
        admin
      );
      expect(created.status).toBe(201);
      const body = eventBody();
      const res = await api.post(
        `/api/v1/webhooks/${project.id}`,
        undefined,
        signLhci(created.json.webhookSecret, body),
        body
      );
      expect(res.status).toBe(202);
      // the upstream routes still work next to it
      expect((await api.get('/healthz')).status).toBe(200);
      expect((await api.get('/v1/projects')).status).toBe(200);
    } finally {
      await server.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});
