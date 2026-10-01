/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Split out from ./indexability.js so that file's pure logic can load directly under Jest: this file
 * imports `MainResource`, which transitively touches `import.meta.url` and cannot be `require()`d inside
 * Jest (the same reason robots-sources.js exists). No tests of its own; real Node loads it in
 * test/lighthouse-config.test.js and live `lhci collect` runs exercise it.
 */

import {MainResource} from 'lighthouse/core/computed/main-resource.js';

/** @typedef {import('./indexability.js').IndexabilityInput} IndexabilityInput */

const ROBOTS_META_NAMES = new Set(['robots', 'googlebot', 'bingbot']);

/**
 * Builds the pure logic's input from artifacts Lighthouse and this package already collected.
 * @param {{
 *   RobotsTxt: import('./robots-txt.js').RobotsTxtArtifact,
 *   MetaElements: Array<{name?: string, content?: string}>,
 *   IndexabilitySignals: import('../gatherers/indexability-signals.js').IndexabilitySignalsArtifact,
 *   DevtoolsLog: unknown,
 *   URL: unknown,
 * }} artifacts
 * @param {import('lighthouse/types/audit.js').default.Context} context
 * @return {Promise<IndexabilityInput | null>} Null when the signals artifact is missing.
 */
async function resolveIndexabilityInput(artifacts, context) {
  const signals = artifacts.IndexabilitySignals;
  if (!signals) return null;

  const mainResource = await MainResource.request(
    {devtoolsLog: artifacts.DevtoolsLog, URL: artifacts.URL},
    context
  );
  const xRobotsTag = (mainResource.responseHeaders || [])
    .filter(h => h.name.toLowerCase() === 'x-robots-tag')
    .map(h => h.value);
  const metas = (artifacts.MetaElements || [])
    .map(m => ({name: (m.name || '').toLowerCase(), content: m.content || ''}))
    .filter(m => ROBOTS_META_NAMES.has(m.name));

  return {
    pageUrl: signals.pageUrl,
    status: Number.isFinite(mainResource.statusCode) ? mainResource.statusCode : null,
    robotsTxt: artifacts.RobotsTxt || null,
    metas,
    xRobotsTag,
    canonicals: signals.canonicals,
    target: signals.target,
    bodyTextLength: signals.bodyTextLength,
  };
}

export {resolveIndexabilityInput};
