/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fetches the site's `/llms.txt` (at the origin root only; the format also allows a subpath file,
 * which is deferred). One bounded request through `../lib/safe-fetch.js`'s `safeFetchBytes`
 * (SSRF-protected, no redirects followed, 1 MiB cap, 5 s deadline); the URL is built from the
 * audited page's own origin, never from anything the page says.
 *
 * Every outcome is data, never a throw. A file that could not be checked (server error, a refused
 * private address, too large) also adds a run warning saying why, so the audit is not silently
 * not-applicable.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {safeFetchBytes} from '../lib/safe-fetch.js';

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 1024 * 1024;

/**
 * @typedef {{
 *   url: string,
 *   state: 'present' | 'absent' | 'unavailable',
 *   status: number | null,
 *   reason: string | null,
 *   text: string | null,
 * }} LlmsTxtArtifact
 */
/** @typedef {typeof safeFetchBytes} FetchBytes */

/**
 * @param {{finalDisplayedUrl: string}} url
 * @param {{fetchBytes?: FetchBytes}} [deps] Injectable so tests never touch the network.
 * @return {Promise<LlmsTxtArtifact>}
 */
async function collectLlmsTxt(url, {fetchBytes = safeFetchBytes} = {}) {
  const llmsUrl = new URL('/llms.txt', url.finalDisplayedUrl).href;
  /** @type {LlmsTxtArtifact} */
  const artifact = {url: llmsUrl, state: 'unavailable', status: null, reason: null, text: null};

  let response;
  try {
    response = await fetchBytes(llmsUrl, {timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES});
  } catch (err) {
    artifact.reason = `${llmsUrl} could not be fetched: ${
      err instanceof Error ? err.message : err
    }`;
    return artifact;
  }

  artifact.status = response.status;
  if (response.status >= 200 && response.status < 300) {
    artifact.state = 'present';
    artifact.text = response.body.toString('utf-8');
  } else if (response.status >= 400 && response.status < 500) {
    artifact.state = 'absent';
  } else if (response.status >= 300 && response.status < 400) {
    artifact.reason = `${llmsUrl} redirects to ${
      response.redirectLocation || '(no Location)'
    }, which is not followed`;
  } else {
    artifact.reason = `${llmsUrl} returned HTTP ${response.status}`;
  }
  return artifact;
}

/**
 * @param {LlmsTxtArtifact} artifact
 * @return {string | null}
 */
function skippedWarning(artifact) {
  return artifact.state === 'unavailable' && artifact.reason
    ? `llms.txt was not checked: ${artifact.reason}`
    : null;
}

class LlmsTxt extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<LlmsTxtArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const artifact = await collectLlmsTxt(passContext.baseArtifacts.URL);
    const warning = skippedWarning(artifact);
    if (warning) passContext.baseArtifacts.LighthouseRunWarnings.push(warning);
    return artifact;
  }
}

export default LlmsTxt;
export {collectLlmsTxt, skippedWarning};
