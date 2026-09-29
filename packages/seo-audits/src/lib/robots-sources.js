/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Split out from ./robots-directives.js so that file's pure parsing logic can load directly
 * under Jest — this file imports `MainResource`, which transitively touches `import.meta.url`
 * and can't be `require()`d inside Jest under this repo's shared `module: "commonjs"` tsconfig
 * (same issue documented for rule-engine/registry.js).
 */

import {MainResource} from 'lighthouse/core/computed/main-resource.js';

/**
 * Resolves the raw meta-robots content and X-Robots-Tag header value from artifacts already
 * collected by Lighthouse core — no new gatherer needed. Same `MainResource` computed artifact
 * `canonical.js` (core's own audit) already uses for the equivalent "read the main document's
 * response" need.
 * @param {Array<{name?: string, content?: string}>} metaElements
 * @param {{DevtoolsLog: unknown, URL: unknown}} artifacts
 * @param {import('lighthouse/types/audit.js').default.Context} context
 * @return {Promise<{metaContent: string | undefined, headerValue: string | undefined}>}
 */
async function resolveRobotsSources(metaElements, artifacts, context) {
  const mainResource = await MainResource.request(
    {devtoolsLog: artifacts.DevtoolsLog, URL: artifacts.URL},
    context
  );

  const metaRobots = metaElements.find(m => m.name === 'robots');
  const headerEntry = (mainResource.responseHeaders || []).find(
    h => h.name.toLowerCase() === 'x-robots-tag'
  );

  return {
    metaContent: metaRobots ? metaRobots.content : undefined,
    headerValue: headerEntry ? headerEntry.value : undefined,
  };
}

export {resolveRobotsSources};
