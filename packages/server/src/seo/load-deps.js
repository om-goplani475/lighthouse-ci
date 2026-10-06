/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Loads the pure checks from `@lhci/seo-audits`, an ES-module package, into this CommonJS server. A dynamic `import()` is
 * the only way a CommonJS file can load an ES module on the Node versions this repo supports (18+).
 */
'use strict';

/** @return {Promise<import('./seo-routes.js').SeoDeps>} */
async function loadSeoDeps() {
  const base = '@lhci/seo-audits/src/service';
  const [signature, payload, hosts, config, runner] = await Promise.all([
    import(`${base}/webhook-signature.js`),
    import(`${base}/webhook-payload.js`),
    import(`${base}/host-allow-list.js`),
    import(`${base}/project-config.js`),
    import(`${base}/run-audit.js`),
  ]);
  return {
    verifyWebhook: signature.verifyWebhook,
    createReplayGuard: signature.createReplayGuard,
    normalizeWebhook: payload.normalizeWebhook,
    checkAuditUrl: hosts.checkAuditUrl,
    validateAllowList: hosts.validateAllowList,
    validateConfig: config.validateConfig,
    runAudit: runner.createRunAudit({
      recommended: require('@lhci/seo-audits/src/recommended-assertions.json'),
      lhciCli: require.resolve('@lhci/cli/src/cli.js'),
      lighthouseConfig: require.resolve('@lhci/seo-audits/src/lighthouse-config.js'),
    }),
  };
}

module.exports = {loadSeoDeps};
