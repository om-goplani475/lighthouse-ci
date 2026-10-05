/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Collects what the informational `amp-check` audit needs: whether the page is itself an AMP page, the AMP
 * version it links to (`<link rel="amphtml">`), its canonical, and, when it links to an AMP version, one bounded
 * request to that version (status, canonical, noindex) through `../lib/hreflang-checks.js` (same safe fetch
 * policy: the page's own origin through the normal fetch, another host through the strict public-only fetch; the
 * first 128 KiB, about 5 s, no redirect followed). At most one request. `LHCI_SEO_AMP_CHECK=0` switches it off.
 * Every outcome is data, never a throw.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {checkAlternates} from '../lib/hreflang-checks.js';

/* eslint-env browser */

/**
 * @typedef {import('../lib/hreflang-checks.js').AlternateCheck} AlternateCheck
 * @typedef {{
 *   pageUrl: string,
 *   isAmp: boolean,
 *   canonical: string | null,
 *   ampUrl: string | null,
 *   state: 'none' | 'checked' | 'disabled',
 *   reason: string | null,
 *   check: AlternateCheck | null,
 * }} AmpPageArtifact
 */

const SWITCH_ENV = 'LHCI_SEO_AMP_CHECK';

/* c8 ignore start */
function collectInPage() {
  const html = document.documentElement;
  const amp = document.querySelector('head link[rel~="amphtml" i]');
  const canonical = document.querySelector('head link[rel~="canonical" i]');
  return {
    pageUrl: location.href,
    isAmp: html.hasAttribute('amp') || html.hasAttribute('⚡'),
    canonical: canonical ? /** @type {HTMLLinkElement} */ (canonical).href : null,
    ampUrl: amp ? /** @type {HTMLLinkElement} */ (amp).href : null,
  };
}
/* c8 ignore stop */

/**
 * @param {{pageUrl: string, isAmp: boolean, canonical: string | null, ampUrl: string | null}} page
 * @param {{env?: NodeJS.ProcessEnv, check?: typeof checkAlternates}} [deps]
 * @return {Promise<AmpPageArtifact>}
 */
async function collectAmpPage(page, {env = process.env, check = checkAlternates} = {}) {
  /** @type {AmpPageArtifact} */
  const artifact = {...page, state: 'none', reason: null, check: null};
  if (!page.ampUrl) return artifact;
  if (env[SWITCH_ENV] === '0') {
    return {
      ...artifact,
      state: 'disabled',
      reason: `The request to the AMP version is switched off (${SWITCH_ENV}=0).`,
    };
  }
  const {results} = await check({
    pageUrl: page.pageUrl,
    alternates: [{hreflang: 'amp', href: page.ampUrl}],
    limit: 1,
  });
  return {...artifact, state: 'checked', check: results[0] || null};
}

class AmpPage extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<AmpPageArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const page = await passContext.driver.executionContext.evaluate(collectInPage, {
      args: [],
      useIsolation: true,
      deps: [],
    });
    return collectAmpPage(page);
  }
}

export default AmpPage;
export {collectAmpPage, SWITCH_ENV};
