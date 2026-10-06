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
  const [signature, payload, hosts, config] = await Promise.all([
    import(`${base}/webhook-signature.js`),
    import(`${base}/webhook-payload.js`),
    import(`${base}/host-allow-list.js`),
    import(`${base}/project-config.js`),
  ]);
  return {
    verifyWebhook: signature.verifyWebhook,
    createReplayGuard: signature.createReplayGuard,
    normalizeWebhook: payload.normalizeWebhook,
    checkAuditUrl: hosts.checkAuditUrl,
    validateAllowList: hosts.validateAllowList,
    validateConfig: config.validateConfig,
  };
}

module.exports = {loadSeoDeps};
