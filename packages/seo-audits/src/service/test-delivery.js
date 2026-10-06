/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure half of `send-test-webhook.js`: reads its arguments and builds one signed delivery in the generic `lhci` form
 * (the one `webhook-signature.js` verifies). Pure apart from `crypto` and the clock.
 */

import crypto from 'crypto';
import {hmacHex} from './webhook-signature.js';

const USAGE = `Usage: send-test-webhook <webhook-url> --target-url <url> [options]

Sends one signed test delivery to the SEO webhook service, as a CI job would. The project must use the "A CI job
(signed JSON)" provider. The secret is read from the LHCI_WEBHOOK_SECRET environment variable, or from --secret-file;
there is no --secret flag, so it never lands in your shell history or process list.

  <webhook-url>        for example https://abc.ngrok-free.app/api/v1/webhooks/<project id>
  --target-url <url>   the page to audit (its host must be on the project's allow-list)
  --repo <owner/name>  default acme/test-site
  --branch <name>      default main
  --base-branch <name> for a pull-request-like run, the branch to compare with
  --pr <number>        a pull request number
  --sha <hex>          a commit id; default: a random one
  --secret-file <path> read the secret from this file instead of the environment
  --help
`;

/**
 * @param {string[]} argv
 * @return {{url?: string, targetUrl?: string, repo: string, branch: string, baseBranch?: string, pr?: number, sha?: string, secretFile?: string, help: boolean, error?: string}}
 */
function parseArgs(argv) {
  /** @type {ReturnType<typeof parseArgs>} */
  const args = {repo: 'acme/test-site', branch: 'main', help: false};
  /** @param {string} message The first problem found is the one reported. */
  const fail = message => {
    if (!args.error) args.error = message;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--target-url') args.targetUrl = value();
    else if (a === '--repo') args.repo = String(value());
    else if (a === '--branch') args.branch = String(value());
    else if (a === '--base-branch') args.baseBranch = value();
    else if (a === '--pr') args.pr = Number(value());
    else if (a === '--sha') args.sha = value();
    else if (a === '--secret-file') args.secretFile = value();
    else if (a === '--secret') {
      value(); // consume the secret so it is not mistaken for the URL
      fail('There is no --secret flag; use LHCI_WEBHOOK_SECRET or --secret-file.');
    } else if (a === '--secret-OLD') {
      args.error = 'There is no --secret flag; use LHCI_WEBHOOK_SECRET or --secret-file.';
    } else if (a.startsWith('--')) fail(`Unknown option ${a}`);
    else if (!args.url) args.url = a;
    else fail('Only one webhook URL can be given.');
  }
  if (!args.help && !args.error) {
    if (!args.url) args.error = 'Give the webhook URL.';
    else if (!args.targetUrl) args.error = 'Give --target-url, the page to audit.';
    else if (args.pr !== undefined && (!Number.isInteger(args.pr) || args.pr < 1)) {
      args.error = '--pr must be a whole number of at least 1.';
    } else if (args.sha !== undefined && !/^[0-9a-f]{7,64}$/i.test(args.sha)) {
      args.error = '--sha must be 7 to 64 hex characters.';
    }
  }
  return args;
}

/**
 * @param {{secret: string, payload: Record<string, unknown>, now?: number}} input
 * @return {{body: string, headers: Record<string, string>}} The exact body and headers to send.
 */
function buildDelivery({secret, payload, now = Date.now()}) {
  const body = JSON.stringify(payload);
  const stamp = String(Math.floor(now / 1000));
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-lhci-timestamp': stamp,
      'x-lhci-signature': `sha256=${hmacHex(secret, `${stamp}.${body}`)}`,
    },
  };
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 * @return {Record<string, unknown>}
 */
function payloadFrom(args) {
  return {
    repo: args.repo,
    sha: args.sha || crypto.randomBytes(20).toString('hex'),
    url: args.targetUrl,
    branch: args.branch,
    ...(args.baseBranch && {baseBranch: args.baseBranch}),
    ...(args.pr && {prNumber: args.pr}),
  };
}

export {parseArgs, buildDelivery, payloadFrom, USAGE};
