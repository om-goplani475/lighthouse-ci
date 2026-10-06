#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sends one signed test delivery to the SEO webhook service, so the whole chain (signature, allow-list, queue, audit, comment,
 * alert) can be tried without a GitHub or GitLab repository. See `test-delivery.js` for the options.
 *
 *   LHCI_WEBHOOK_SECRET=... node packages/seo-audits/src/service/send-test-webhook.js \\
 *     https://abc.ngrok-free.app/api/v1/webhooks/<project id> --target-url https://web.dev/ --branch main
 *
 * Exit codes: 0 when the service queued, ignored or already had the delivery; 1 when it refused it; 2 on bad usage.
 */

/* global fetch */

import fs from 'fs';
import {parseArgs, buildDelivery, payloadFrom, USAGE} from './test-delivery.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (args.error) {
  process.stderr.write(`${args.error}\n\n${USAGE}`);
  process.exit(2);
}

let secret = process.env.LHCI_WEBHOOK_SECRET || '';
if (args.secretFile) {
  try {
    secret = fs.readFileSync(args.secretFile, 'utf8').trim();
  } catch (err) {
    process.stderr.write(
      `Could not read ${args.secretFile}: ${err instanceof Error ? err.message : 'unreadable'}\n`
    );
    process.exit(2);
  }
}
if (!secret) {
  process.stderr.write('No secret: set LHCI_WEBHOOK_SECRET or use --secret-file.\n');
  process.exit(2);
}

const payload = payloadFrom(args);
const {body, headers} = buildDelivery({secret, payload});
process.stdout.write(
  `Sending a delivery for ${payload.repo}@${String(payload.sha).slice(0, 7)} (${payload.branch}${
    payload.prNumber ? `, PR #${payload.prNumber}` : ''
  }) to audit ${payload.url}\n`
);

/** @return {Promise<void>} */
async function main() {
  try {
    const res = await fetch(/** @type {string} */ (args.url), {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    const text = (await res.text()).slice(0, 500);
    process.stdout.write(`The service answered ${res.status}: ${text}\n`);
    process.exit(res.status >= 200 && res.status < 300 ? 0 : 1);
  } catch (err) {
    process.stderr.write(
      `Could not reach the service: ${err instanceof Error ? err.message : 'unknown error'}\n`
    );
    process.exit(1);
  }
}

main();
