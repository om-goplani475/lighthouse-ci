/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {parseArgs, buildDelivery, payloadFrom} = require('../../src/service/test-delivery.js');
const {verifyWebhook} = require('../../src/service/webhook-signature.js');
const {normalizeWebhook} = require('../../src/service/webhook-payload.js');

const CLI = path.join(__dirname, '../../src/service/send-test-webhook.js');
const URL_ARGS = ['https://x.test/api/v1/webhooks/p', '--target-url', 'https://web.dev/'];

describe('parseArgs', () => {
  it('reads the options and applies defaults', () => {
    const args = parseArgs([
      ...URL_ARGS,
      '--branch',
      'feat',
      '--base-branch',
      'main',
      '--pr',
      '7',
      '--sha',
      'ABCDEF1',
      '--repo',
      'a/b',
    ]);
    expect(args).toMatchObject({
      url: 'https://x.test/api/v1/webhooks/p',
      targetUrl: 'https://web.dev/',
      branch: 'feat',
      baseBranch: 'main',
      pr: 7,
      sha: 'ABCDEF1',
      repo: 'a/b',
    });
    expect(parseArgs(URL_ARGS)).toMatchObject({
      repo: 'acme/test-site',
      branch: 'main',
    });
  });

  it.each([
    [[], /webhook URL/],
    [['https://x.test/'], /--target-url/],
    [[...URL_ARGS, '--pr', '0'], /--pr/],
    [[...URL_ARGS, '--pr', 'x'], /--pr/],
    [[...URL_ARGS, '--sha', 'nothex'], /--sha/],
    [[...URL_ARGS, '--nope'], /Unknown option/],
    [[...URL_ARGS, 'https://second.test/'], /Only one/],
    [[...URL_ARGS, '--secret', 'hunter2'], /no --secret flag/],
  ])('rejects %j', (argv, pattern) => {
    expect(parseArgs(argv).error).toMatch(pattern);
  });

  it('answers --help without needing the rest', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('buildDelivery', () => {
  it('produces a delivery the service accepts, and a payload it normalises', () => {
    const payload = payloadFrom(
      parseArgs([...URL_ARGS, '--branch', 'feat', '--base-branch', 'main', '--pr', '3'])
    );
    const {body, headers} = buildDelivery({secret: 's3cret', payload, now: 1_800_000_000_000});
    expect(
      verifyWebhook({
        provider: 'lhci',
        headers,
        rawBody: body,
        secret: 's3cret',
        now: 1_800_000_000_000,
      }).ok
    ).toBe(true);
    expect(
      verifyWebhook({
        provider: 'lhci',
        headers,
        rawBody: body,
        secret: 'other',
        now: 1_800_000_000_000,
      }).ok
    ).toBe(false);
    const outcome = normalizeWebhook({provider: 'lhci', body: JSON.parse(body)});
    expect(outcome).toMatchObject({
      kind: 'audit',
      request: {
        repo: 'acme/test-site',
        branch: 'feat',
        baseBranch: 'main',
        prNumber: 3,
        url: 'https://web.dev/',
      },
    });
  });

  it('makes a fresh valid sha each time when none is given, and omits optional fields', () => {
    const a = payloadFrom(parseArgs(URL_ARGS));
    const b = payloadFrom(parseArgs(URL_ARGS));
    expect(a.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(a.sha).not.toBe(b.sha);
    expect('prNumber' in a).toBe(false);
    expect('baseBranch' in a).toBe(false);
  });
});

describe('the command', () => {
  /** @param {string[]} argv @param {Record<string, string>} env @return {Promise<{code: number, out: string}>} */
  const run = (argv, env) =>
    new Promise(resolve => {
      const child = spawn(process.execPath, [CLI, ...argv], {
        env: {PATH: process.env.PATH, ...env},
      });
      let out = '';
      child.stdout.on('data', c => (out += c));
      child.stderr.on('data', c => (out += c));
      child.on('exit', code => resolve({code, out}));
    });

  /** @param {number} status @return {Promise<{port: number, seen: any[], close: () => Promise<void>}>} */
  const service = status => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        seen.push({url: req.url, headers: req.headers, body});
        res.writeHead(status, {'content-type': 'application/json'});
        res.end(JSON.stringify({status: status === 202 ? 'queued' : 'refused'}));
      });
    });
    return new Promise(resolve =>
      server.listen(0, '127.0.0.1', () =>
        resolve({port: server.address().port, seen, close: () => new Promise(r => server.close(r))})
      )
    );
  };

  it('sends a delivery that verifies with the secret, and exits 0 when queued', async () => {
    const s = await service(202);
    try {
      const {code, out} = await run(
        [`http://127.0.0.1:${s.port}/hook`, '--target-url', 'https://web.dev/'],
        {LHCI_WEBHOOK_SECRET: 'abc123'}
      );
      expect(code).toBe(0);
      expect(out).toMatch(/answered 202/);
      expect(s.seen).toHaveLength(1);
      expect(
        verifyWebhook({
          provider: 'lhci',
          headers: s.seen[0].headers,
          rawBody: s.seen[0].body,
          secret: 'abc123',
        }).ok
      ).toBe(true);
    } finally {
      await s.close();
    }
  }, 20000);

  it('reads the secret from a file, exits 1 when the service refuses, and never prints the secret', async () => {
    const s = await service(401);
    const file = path.join(os.tmpdir(), `lhci-secret-${process.pid}`);
    fs.writeFileSync(file, 'file-secret-value\n');
    try {
      const {code, out} = await run(
        [
          `http://127.0.0.1:${s.port}/hook`,
          '--target-url',
          'https://web.dev/',
          '--secret-file',
          file,
        ],
        {}
      );
      expect(code).toBe(1);
      expect(out).not.toContain('file-secret-value');
      expect(
        verifyWebhook({
          provider: 'lhci',
          headers: s.seen[0].headers,
          rawBody: s.seen[0].body,
          secret: 'file-secret-value',
        }).ok
      ).toBe(true);
    } finally {
      fs.unlinkSync(file);
      await s.close();
    }
  }, 20000);

  it('exits 2 with no secret, with a bad option, and with an unreadable secret file; 1 when unreachable', async () => {
    expect((await run(['http://127.0.0.1:1/x', '--target-url', 'https://web.dev/'], {})).code).toBe(
      2
    );
    expect((await run(['--bogus'], {LHCI_WEBHOOK_SECRET: 'x'})).code).toBe(2);
    expect(
      (
        await run(
          [
            'http://127.0.0.1:1/x',
            '--target-url',
            'https://web.dev/',
            '--secret-file',
            '/nonexistent/file',
          ],
          {}
        )
      ).code
    ).toBe(2);
    const down = await run(['http://127.0.0.1:1/x', '--target-url', 'https://web.dev/'], {
      LHCI_WEBHOOK_SECRET: 'x',
    });
    expect(down.code).toBe(1);
    expect(down.out).toMatch(/Could not reach/);
  }, 20000);

  it('prints usage for --help', async () => {
    const {code, out} = await run(['--help'], {});
    expect(code).toBe(0);
    expect(out).toMatch(/LHCI_WEBHOOK_SECRET/);
  });
});
