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
  const [signature, payload, hosts, config, runner, notifier, outbound, sarif, result, history] =
    await Promise.all([
      import(`${base}/webhook-signature.js`),
      import(`${base}/webhook-payload.js`),
      import(`${base}/host-allow-list.js`),
      import(`${base}/project-config.js`),
      import(`${base}/run-audit.js`),
      import(`${base}/notifier.js`),
      import(`${base}/outbound.js`),
      import('@lhci/seo-audits/src/summary/sarif.js'),
      import(`${base}/run-result.js`),
      import(`${base}/run-history.js`),
    ]);
  const recommended = require('@lhci/seo-audits/src/recommended-assertions.json');
  return {
    verifyWebhook: signature.verifyWebhook,
    createReplayGuard: signature.createReplayGuard,
    normalizeWebhook: payload.normalizeWebhook,
    checkAuditUrl: hosts.checkAuditUrl,
    validateAllowList: hosts.validateAllowList,
    validateConfig: config.validateConfig,
    describeProject: projectConfig => ({
      ...config.describeOptions(recommended),
      effective: config.resolveSeverities(projectConfig, recommended),
    }),
    validateNotifications: notifier.validateNotifications,
    mergeNotifications: notifier.mergeNotifications,
    publicNotifications: notifier.publicNotifications,
    dispatchRun: notifier.dispatchRun,
    send: outbound.createOutbound(),
    toSarif: sarif.toSarif,
    isRepoPath: sarif.isRepoPath,
    reviveRun: result.reviveRun,
    buildHistory: history.buildHistory,
    historyToCsv: history.historyToCsv,
    compareStored: history.compareStored,
    toolVersion: require('@lhci/seo-audits/package.json').version,
    runAudit: runner.createRunAudit({
      recommended,
      lhciCli: require.resolve('@lhci/cli/src/cli.js'),
      lighthouseConfig: require.resolve('@lhci/seo-audits/src/lighthouse-config.js'),
    }),
  };
}

module.exports = {loadSeoDeps};
