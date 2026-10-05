/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-user ("field") Core Web Vitals for the audited page from Google's CrUX API, which Lighthouse
 * (lab-only) does not have. OFF unless `LHCI_SEO_CRUX_API_KEY` is set: without it nothing is sent.
 *
 * What is sent to Google: the page's origin plus path (the query string and fragment are dropped, in case
 * they carry tokens) and the form factor of the run, with the API key in a header (see lib/crux-client.js).
 * An address that is not a public host name (localhost, an IP literal, a name without a dot, a `.local` or
 * `.internal` name) is never sent. The URL is tried first; if CrUX has no data for it, its origin is tried
 * and the artifact says which one answered. Every outcome is data, never a throw.
 */

import net from 'net';
import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {queryCrux} from '../lib/crux-client.js';

/**
 * @typedef {{p75: number | null, good: number | null, needsImprovement: number | null, poor: number | null}} FieldMetric
 * @typedef {{
 *   state: 'ok' | 'disabled' | 'unavailable' | 'no-data' | 'error',
 *   reason: string | null,
 *   source: 'url' | 'origin' | null,
 *   target: string | null,
 *   formFactor: 'PHONE' | 'DESKTOP' | null,
 *   collectionPeriod: {first: string, last: string} | null,
 *   metrics: Record<string, FieldMetric>,
 * }} FieldDataArtifact
 */

const KEY_ENV = 'LHCI_SEO_CRUX_API_KEY';
const RESERVED_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.test',
  '.invalid',
  '.example',
];
const METRIC_NAMES = {
  lcp: 'largest_contentful_paint',
  inp: 'interaction_to_next_paint',
  cls: 'cumulative_layout_shift',
  fcp: 'first_contentful_paint',
  ttfb: 'experimental_time_to_first_byte',
};

/**
 * @param {string} hostname
 * @return {boolean} Whether this looks like a public domain name that CrUX could know.
 */
function isPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || net.isIP(host) !== 0 || !host.includes('.')) return false;
  return !RESERVED_SUFFIXES.some(suffix => host.endsWith(suffix));
}

/**
 * @param {unknown} value
 * @return {number | null}
 */
function numberOrNull(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * @param {any} record A CrUX `record`.
 * @return {Record<string, FieldMetric>}
 */
function metricsOf(record) {
  /** @type {Record<string, FieldMetric>} */
  const out = {};
  for (const [short, long] of Object.entries(METRIC_NAMES)) {
    const metric = record && record.metrics && record.metrics[long];
    if (!metric || typeof metric !== 'object') continue;
    const histogram = Array.isArray(metric.histogram) ? metric.histogram : [];
    out[short] = {
      p75: numberOrNull(metric.percentiles && metric.percentiles.p75),
      good: numberOrNull(histogram[0] && histogram[0].density),
      needsImprovement: numberOrNull(histogram[1] && histogram[1].density),
      poor: numberOrNull(histogram[2] && histogram[2].density),
    };
  }
  return out;
}

/**
 * @param {any} record
 * @return {{first: string, last: string} | null}
 */
function periodOf(record) {
  const p = record && record.collectionPeriod;
  /** @param {any} d */
  const date = d =>
    d && d.year && d.month && d.day
      ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
      : null;
  const first = p && date(p.firstDate);
  const last = p && date(p.lastDate);
  return first && last ? {first, last} : null;
}

/**
 * @param {string} reason
 * @param {FieldDataArtifact['state']} state
 * @return {FieldDataArtifact}
 */
function empty(state, reason) {
  return {
    state,
    reason,
    source: null,
    target: null,
    formFactor: null,
    collectionPeriod: null,
    metrics: {},
  };
}

/**
 * @param {string} pageUrl The audited page's final URL.
 * @param {'mobile' | 'desktop' | string | undefined} formFactor The run's form factor.
 * @param {{env?: NodeJS.ProcessEnv, post?: import('../lib/crux-client.js').PostFn}} [deps] Injectable so tests
 *   never touch the network.
 * @return {Promise<FieldDataArtifact>}
 */
async function collectFieldData(pageUrl, formFactor, {env = process.env, post} = {}) {
  const apiKey = (env[KEY_ENV] || '').trim();
  if (!apiKey) {
    return empty('disabled', `Field data is off: set ${KEY_ENV} to a Google API key to enable it.`);
  }

  /** @type {URL} */
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return empty('unavailable', 'The audited URL could not be read.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isPublicHostname(url.hostname)) {
    return empty(
      'unavailable',
      'The audited address is not a public web site, so nothing was sent to Google.'
    );
  }

  const factor = formFactor === 'desktop' ? 'DESKTOP' : 'PHONE';
  const sentUrl = `${url.origin}${url.pathname}`;
  /** @type {Array<['url' | 'origin', {url: string} | {origin: string}, string]>} */
  const attempts = [
    ['url', {url: sentUrl}, sentUrl],
    ['origin', {origin: url.origin}, url.origin],
  ];
  for (const [source, target, label] of attempts) {
    const result = await queryCrux({apiKey, target, formFactor: factor, post});
    if (result.state === 'error') return {...empty('error', result.reason), formFactor: factor};
    if (result.state === 'ok') {
      const metrics = metricsOf(result.record);
      if (Object.keys(metrics).length === 0) continue;
      return {
        state: 'ok',
        reason: null,
        source,
        target: label,
        formFactor: factor,
        collectionPeriod: periodOf(result.record),
        metrics,
      };
    }
  }
  return {
    ...empty(
      'no-data',
      'CrUX has no field data for this URL or its origin (it covers sites with enough real visits).'
    ),
    formFactor: factor,
  };
}

class FieldData extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<FieldDataArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    return collectFieldData(
      passContext.baseArtifacts.URL.finalDisplayedUrl,
      passContext.settings.formFactor
    );
  }
}

export default FieldData;
export {collectFieldData, isPublicHostname, KEY_ENV};
