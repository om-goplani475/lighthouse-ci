/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Split out from ./transport-security.js so that file's pure logic can load directly under Jest: this
 * file imports `MainResource` and `NetworkRecords`, which transitively touch `import.meta.url` and
 * cannot be `require()`d inside Jest under this repo's shared `module: "commonjs"` tsconfig (the same
 * reason robots-sources.js exists). It has no tests of its own; real Node loads it in
 * test/lighthouse-config.test.js, and live `lhci collect` runs exercise it.
 */

import {MainResource} from 'lighthouse/core/computed/main-resource.js';
import {NetworkRecords} from 'lighthouse/core/computed/network-records.js';
import {findSecurityDetails} from './transport-security.js';

/**
 * Everything the HSTS and certificate audits need about the main document, from artifacts Lighthouse
 * already collected: no new gatherer and no request of our own.
 * @param {{DevtoolsLog: unknown, URL: unknown}} artifacts
 * @param {import('lighthouse/types/audit.js').default.Context} context
 * @return {Promise<{
 *   finalUrl: string,
 *   hstsHeaderValues: string[],
 *   securityDetails: Record<string, unknown> | null,
 * }>}
 */
async function resolveMainDocumentSecurity(artifacts, context) {
  const mainResource = await MainResource.request(
    {devtoolsLog: artifacts.DevtoolsLog, URL: artifacts.URL},
    context
  );
  const hstsHeaderValues = (mainResource.responseHeaders || [])
    .filter(h => h.name.toLowerCase() === 'strict-transport-security')
    .map(h => h.value);

  return {
    finalUrl: mainResource.url,
    hstsHeaderValues,
    securityDetails: findSecurityDetails(artifacts.DevtoolsLog, mainResource.requestId),
  };
}

/**
 * The plain-`http:` requests the page made, for the mixed-content audit (a page's insecure requests
 * that Chrome did not raise an issue about still show up here).
 * @param {{DevtoolsLog: unknown}} artifacts
 * @param {import('lighthouse/types/audit.js').default.Context} context
 * @return {Promise<Array<{url: string, resourceType: string}>>}
 */
async function resolveInsecureRecords(artifacts, context) {
  // `DevtoolsLog` is typed `unknown` here (as in robots-sources.js); Lighthouse's own type is the
  // closed `LH.DevtoolsLog`, which this package's JSDoc cannot name without importing core's globals.
  const records = await NetworkRecords.request(/** @type {any} */ (artifacts.DevtoolsLog), context);
  return records
    .filter(record => record.url.startsWith('http:'))
    .map(record => ({url: record.url, resourceType: record.resourceType || 'Unknown'}));
}

export {resolveMainDocumentSecurity, resolveInsecureRecords};
