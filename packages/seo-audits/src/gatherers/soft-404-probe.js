/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Requests two made-up URLs on the audited page's own origin and records what the site answers (a
 * soft-404 check: see ../lib/soft-404.js for what each answer means). Every URL is built here from the
 * page's origin and a random token, never from anything the page says. Requests go through
 * `../lib/safe-fetch.js`'s `safeFetchStatus` (SSRF-protected, status only, no redirect followed
 * automatically, 5 s each). A redirect that stays on the same origin is requested once more (one hop,
 * status only); one that leaves the origin is never requested. At most four requests, the two probes
 * running in parallel, so the worst case is about 10 s.
 *
 * Every outcome is data, never a throw. If neither probe could be requested the run carries a warning
 * saying why, so the audit is not silently not-applicable.
 */

import {randomBytes} from 'crypto';
import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {safeFetchStatus} from '../lib/safe-fetch.js';
import {probeUrls, classifyFirstResponse, classifyRedirectTarget} from '../lib/soft-404.js';

const TIMEOUT_MS = 5_000;

/** @typedef {import('../lib/soft-404.js').Probe} Probe */
/** @typedef {import('../lib/soft-404.js').Soft404Artifact} Soft404Artifact */
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
 * @param {{shape: Probe['shape'], url: string}} spec
 * @param {FetchStatus} fetchStatus
 * @return {Promise<Probe>}
 */
async function runProbe(spec, fetchStatus) {
  /** @type {Probe} */
  const probe = {
    shape: spec.shape,
    url: spec.url,
    status: null,
    location: null,
    targetStatus: null,
    outcome: 'failed',
    reason: null,
  };

  let first;
  try {
    first = await fetchStatus(spec.url, {timeoutMs: TIMEOUT_MS});
  } catch (err) {
    probe.reason = messageOf(err);
    return probe;
  }
  probe.status = first.status;
  const step = classifyFirstResponse(spec.url, first.status, first.redirectLocation);
  probe.outcome = step.outcome;
  probe.reason = step.reason;
  probe.location = step.location;
  if (!step.follow) return probe;

  try {
    const target = await fetchStatus(step.follow, {timeoutMs: TIMEOUT_MS});
    probe.targetStatus = target.status;
    probe.outcome = classifyRedirectTarget(target.status);
  } catch (err) {
    probe.outcome = 'failed';
    probe.reason = `the redirect target ${step.follow} could not be requested: ${messageOf(err)}`;
  }
  return probe;
}

/**
 * @param {{finalDisplayedUrl: string}} url
 * @param {{fetchStatus?: FetchStatus, random?: () => string}} [deps] Injectable so tests never touch
 *   the network.
 * @return {Promise<Soft404Artifact>}
 */
async function collectSoft404Probe(
  url,
  {fetchStatus = safeFetchStatus, random = () => randomBytes(6).toString('hex')} = {}
) {
  const origin = new URL(url.finalDisplayedUrl).origin;
  const probes = await Promise.all(
    probeUrls(origin, random()).map(spec => runProbe(spec, fetchStatus))
  );
  const allFailed = probes.every(p => p.outcome === 'failed');
  return {
    origin,
    probes,
    unavailableReason: allFailed ? probes[0].reason : null,
  };
}

/**
 * @param {Soft404Artifact} artifact
 * @return {string | null}
 */
function skippedWarning(artifact) {
  return artifact.unavailableReason
    ? `The soft-404 check was skipped: ${artifact.unavailableReason}`
    : null;
}

class Soft404Probe extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<Soft404Artifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const artifact = await collectSoft404Probe(passContext.baseArtifacts.URL);
    const warning = skippedWarning(artifact);
    if (warning) passContext.baseArtifacts.LighthouseRunWarnings.push(warning);
    return artifact;
  }
}

export default Soft404Probe;
export {collectSoft404Probe, skippedWarning};
