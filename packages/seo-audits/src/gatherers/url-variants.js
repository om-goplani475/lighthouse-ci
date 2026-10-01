/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Requests the audited URL's other http/https/www forms and follows each one's redirects by hand,
 * recording every hop (see ../lib/url-variants.js for which variants and what the chains mean). The
 * URLs are built here from the page's own host and path, never from anything the page says. Requests go
 * through `../lib/safe-fetch.js`'s `safeFetchStatus` (SSRF-protected, status only, no redirect followed
 * automatically, 5 s each). A redirect is followed only when its target is one of the page's own host
 * variants; any other target is recorded and never requested. Bounds: three variants, at most 5 hops
 * each, 20 s per variant (the variants run in parallel), so the worst case is about 20 s.
 *
 * Every outcome is data, never a throw. A refused address (the private-network policy) adds a run
 * warning that names the cause and the opt-in setting.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {safeFetchStatus} from '../lib/safe-fetch.js';
import {planVariants, MAX_HOPS} from '../lib/url-variants.js';

const REQUEST_TIMEOUT_MS = 5_000;
const VARIANT_BUDGET_MS = 20_000;
const MIN_REQUEST_MS = 1_000;

/** @typedef {import('../lib/url-variants.js').Variant} Variant */
/** @typedef {import('../lib/url-variants.js').UrlVariantsArtifact} UrlVariantsArtifact */
/** @typedef {typeof safeFetchStatus} FetchStatus */

/**
 * @param {unknown} err
 * @return {string}
 */
function messageOf(err) {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

/**
 * A host that does not exist or a closed port is not a failure to report: it means that variant does
 * not exist. A timeout or a policy refusal is different and is reported.
 * @param {unknown} err
 * @return {boolean}
 */
function isNoSuchVariant(err) {
  const code =
    err && typeof err === 'object' ? /** @type {{code?: string}} */ (err).code : undefined;
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(messageOf(err))
  );
}

/**
 * @param {string} url
 * @return {string}
 */
function withoutHash(url) {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

/**
 * @param {{kind: Variant['kind'], url: string}} spec
 * @param {string[]} allowedHosts
 * @param {FetchStatus} fetchStatus
 * @param {() => number} now
 * @return {Promise<Variant>}
 */
async function followVariant(spec, allowedHosts, fetchStatus, now) {
  /** @type {Variant} */
  const variant = {
    kind: spec.kind,
    startUrl: spec.url,
    hops: [],
    end: 'failed',
    endUrl: null,
    reason: null,
  };
  const deadline = now() + VARIANT_BUDGET_MS;
  const seen = new Set();
  let current = spec.url;

  for (let i = 0; i <= MAX_HOPS; i++) {
    seen.add(withoutHash(current));
    const left = deadline - now();
    if (left < MIN_REQUEST_MS) {
      variant.end = 'failed';
      variant.reason = 'the time budget for this variant ran out';
      return variant;
    }

    let response;
    try {
      response = await fetchStatus(current, {timeoutMs: Math.min(REQUEST_TIMEOUT_MS, left)});
    } catch (err) {
      variant.end = i === 0 && isNoSuchVariant(err) ? 'unreachable' : 'failed';
      variant.reason = messageOf(err);
      return variant;
    }
    const location = response.redirectLocation || null;
    variant.hops.push({url: current, status: response.status, location});

    if (!(response.status >= 300 && response.status < 400) || !location) {
      variant.end = 'final';
      variant.endUrl = current;
      return variant;
    }

    let target;
    try {
      target = new URL(location, current);
    } catch {
      variant.end = 'unresolved-location';
      variant.reason = 'the Location is not a valid URL';
      return variant;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      variant.end = 'unresolved-location';
      variant.reason = `the Location uses the "${target.protocol}" scheme`;
      return variant;
    }
    variant.endUrl = target.href;
    if (seen.has(withoutHash(target.href))) {
      variant.end = 'loop';
      return variant;
    }
    if (target.port || !allowedHosts.includes(target.hostname.toLowerCase())) {
      variant.end = 'left-site';
      return variant;
    }
    current = target.href;
  }
  variant.end = 'hop-limit';
  return variant;
}

/**
 * @param {{finalDisplayedUrl: string}} url
 * @param {{fetchStatus?: FetchStatus, now?: () => number}} [deps] Injectable so tests never touch the
 *   network or the clock.
 * @return {Promise<UrlVariantsArtifact>}
 */
async function collectUrlVariants(url, {fetchStatus = safeFetchStatus, now = Date.now} = {}) {
  const plan = planVariants(url.finalDisplayedUrl);
  if (plan.skipped) {
    return {
      audited: url.finalDisplayedUrl,
      canonicalOrigin: null,
      variants: [],
      skipped: plan.skipped,
    };
  }
  const variants = await Promise.all(
    plan.specs.map(spec => followVariant(spec, plan.allowedHosts, fetchStatus, now))
  );
  return {
    audited: url.finalDisplayedUrl,
    canonicalOrigin: plan.canonicalOrigin,
    variants,
    skipped: null,
  };
}

/**
 * @param {UrlVariantsArtifact} artifact
 * @return {string | null}
 */
function skippedWarning(artifact) {
  const refused = artifact.variants.find(
    v => v.end === 'failed' && /^refusing to /.test(v.reason || '')
  );
  return refused
    ? `The URL-variant checks could not request ${refused.startUrl}: ${refused.reason}`
    : null;
}

class UrlVariants extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<UrlVariantsArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const artifact = await collectUrlVariants(passContext.baseArtifacts.URL);
    const warning = skippedWarning(artifact);
    if (warning) passContext.baseArtifacts.LighthouseRunWarnings.push(warning);
    return artifact;
  }
}

export default UrlVariants;
export {collectUrlVariants, skippedWarning};
