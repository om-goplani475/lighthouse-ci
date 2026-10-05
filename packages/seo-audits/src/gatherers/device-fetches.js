/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fetches the audited page twice, once with a mobile and once with a desktop user-agent, so the
 * `device-content-parity` audit can compare what a server sends to each. Two status-and-body requests to
 * the audited page only (no other URL is ever requested), through the SSRF-protected fetch, first 512 KiB,
 * 10 s each, no redirect followed (a redirect makes the page not comparable and is recorded). Both user-agents
 * are ordinary browser strings with a trailing `lhci-seo-audits/1.0` token, so the site can see who asked.
 *
 * `LHCI_SEO_DEVICE_PARITY=0` switches it off. Every outcome is data, never a throw.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {safeFetchPrefix} from '../lib/safe-fetch.js';

/**
 * @typedef {{
 *   status: number | null,
 *   redirectLocation: string | null,
 *   bodyRead: string | null,
 *   truncated: boolean,
 *   html: string | null,
 *   error: string | null,
 * }} DeviceFetch
 * @typedef {{
 *   state: 'fetched' | 'disabled' | 'unavailable',
 *   url: string,
 *   reason: string | null,
 *   mobile: DeviceFetch | null,
 *   desktop: DeviceFetch | null,
 * }} DeviceFetchesArtifact
 */

const SWITCH_ENV = 'LHCI_SEO_DEVICE_PARITY';
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 lhci-seo-audits/1.0';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 lhci-seo-audits/1.0';

/**
 * @param {string} url
 * @param {string} userAgent
 * @param {typeof safeFetchPrefix} fetchPage
 * @return {Promise<DeviceFetch>}
 */
async function fetchAs(url, userAgent, fetchPage) {
  try {
    const result = await fetchPage(url, {maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, userAgent});
    return {
      status: result.status,
      redirectLocation: result.redirectLocation,
      bodyRead: result.bodyRead,
      truncated: result.truncated,
      html: result.bodyRead === 'html' ? result.body.toString('utf8') : null,
      error: null,
    };
  } catch (err) {
    return {
      status: null,
      redirectLocation: null,
      bodyRead: null,
      truncated: false,
      html: null,
      error: String((err && /** @type {Error} */ (err).message) || err).slice(0, 200),
    };
  }
}

/**
 * @param {string} url The audited page's final URL.
 * @param {{env?: NodeJS.ProcessEnv, fetchPage?: typeof safeFetchPrefix}} [deps] Injectable so tests never
 *   touch the network.
 * @return {Promise<DeviceFetchesArtifact>}
 */
async function collectDeviceFetches(url, {env = process.env, fetchPage = safeFetchPrefix} = {}) {
  if (env[SWITCH_ENV] === '0') {
    return {
      state: 'disabled',
      url,
      reason: `The mobile and desktop fetches are switched off (${SWITCH_ENV}=0).`,
      mobile: null,
      desktop: null,
    };
  }
  if (!/^https?:\/\//i.test(url)) {
    return {
      state: 'unavailable',
      url,
      reason: 'The audited URL is not http or https.',
      mobile: null,
      desktop: null,
    };
  }
  const [mobile, desktop] = await Promise.all([
    fetchAs(url, MOBILE_UA, fetchPage),
    fetchAs(url, DESKTOP_UA, fetchPage),
  ]);
  return {state: 'fetched', url, reason: null, mobile, desktop};
}

class DeviceFetches extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<DeviceFetchesArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    return collectDeviceFetches(passContext.baseArtifacts.URL.finalDisplayedUrl);
  }
}

export default DeviceFetches;
export {collectDeviceFetches, MOBILE_UA, DESKTOP_UA, SWITCH_ENV};
