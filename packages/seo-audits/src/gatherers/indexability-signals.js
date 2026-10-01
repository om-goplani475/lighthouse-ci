/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Collects what the indexability audits need that Lighthouse core does not keep: the page's canonical
 * link(s) from the live `<head>`, how much visible text the rendered page has, and, when the canonical
 * points to a different URL, one bounded request to that target (its status, whether it redirects, its
 * robots signals and its own canonical), so "canonical to a 404 / redirect / noindex page" and canonical
 * chains can be reported.
 *
 * The target request is the only network activity, and it is limited: the URL comes from the page, so it
 * is requested only when it is on the page's **own origin** (a cross-origin canonical is recorded and
 * never requested), through `../lib/sitemap-url-sample.js`'s `checkUrls` and `../lib/safe-fetch.js`'s
 * `safeFetchPrefix` (SSRF-protected, no redirect followed, first 64 KiB of HTML, 5 s, one retry for a
 * network error). At most one request. A canonical declared only in an HTTP `Link` header is not seen
 * here (Lighthouse's own `canonical` audit covers headers).
 *
 * Every outcome is data, never a throw.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {safeFetchPrefix} from '../lib/safe-fetch.js';
import {checkUrls, toSampledPage} from '../lib/sitemap-url-sample.js';
import {classifyCanonical} from '../lib/indexability.js';

/* eslint-env browser */

/** @typedef {import('../lib/sitemap-parse.js').SampledPage} SampledPage */
/**
 * @typedef {{
 *   pageUrl: string,
 *   canonicals: string[],
 *   bodyTextLength: number | null,
 *   target: SampledPage | null,
 *   targetSkipped: string | null,
 * }} IndexabilitySignalsArtifact
 */
/** @typedef {typeof safeFetchPrefix} FetchPage */

const MAX_CANONICALS = 10;

/* c8 ignore start */
function collectInPage() {
  const canonicals = Array.from(document.querySelectorAll('link[rel~="canonical" i]'))
    .filter(el => el.closest('head'))
    .map(el => /** @type {HTMLLinkElement} */ (el).href)
    .filter(Boolean)
    .slice(0, 10);
  const text = (document.body && document.body.innerText) || '';
  return {canonicals, bodyTextLength: text.trim().length};
}
/* c8 ignore stop */

/**
 * @param {{canonicals: string[], bodyTextLength: number | null}} page What was read in the browser.
 * @param {string} pageUrl
 * @param {{fetchPage?: FetchPage, now?: () => number}} [deps] Injectable so tests never touch the
 *   network.
 * @return {Promise<IndexabilitySignalsArtifact>}
 */
async function collectIndexabilitySignals(
  page,
  pageUrl,
  {fetchPage = safeFetchPrefix, now = Date.now} = {}
) {
  const canonicals = page.canonicals.slice(0, MAX_CANONICALS);
  /** @type {IndexabilitySignalsArtifact} */
  const artifact = {
    pageUrl,
    canonicals,
    bodyTextLength: page.bodyTextLength,
    target: null,
    targetSkipped: null,
  };

  const canonical = classifyCanonical(pageUrl, canonicals);
  if (canonical.kind === 'conflicting') {
    artifact.targetSkipped = 'the page declares several different canonicals';
    return artifact;
  }
  if (canonical.kind !== 'elsewhere') return artifact;

  const target = /** @type {string} */ (canonical.target);
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    artifact.targetSkipped = 'the canonical is not a valid URL';
    return artifact;
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    artifact.targetSkipped = `the canonical uses the "${targetUrl.protocol}" scheme`;
    return artifact;
  }
  if (targetUrl.origin !== new URL(pageUrl).origin) {
    artifact.targetSkipped = 'the canonical is on another origin, which is not requested';
    return artifact;
  }

  const [check] = await checkUrls([target], {fetchStatus: fetchPage, now});
  artifact.target = toSampledPage(check);
  return artifact;
}

class IndexabilitySignals extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<IndexabilitySignalsArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const page = await passContext.driver.executionContext.evaluate(collectInPage, {
      args: [],
      useIsolation: true,
      deps: [],
    });
    return collectIndexabilitySignals(page, passContext.baseArtifacts.URL.finalDisplayedUrl);
  }
}

export default IndexabilitySignals;
export {collectIndexabilitySignals};
