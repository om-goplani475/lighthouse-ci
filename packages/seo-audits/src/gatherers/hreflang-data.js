/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Collects what the hreflang audits need: the page's own hreflang links (from its live `<head>`), its canonical,
 * its `lang`, `content-language` and `og:locale`, and, unless switched off, what each alternate version answers
 * (see ../lib/hreflang-checks.js for the bounds). `LHCI_SEO_HREFLANG_MAX_CHECKS` sets how many alternates are
 * requested (default 10, at most 25); `0` switches the requests off and the audits that need them are then not
 * applicable. A page with no hreflang links makes no request. HTTP `Link` headers are not read here.
 * Every outcome is data, never a throw.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {checkAlternates} from '../lib/hreflang-checks.js';

/* eslint-env browser */

/**
 * @typedef {import('../lib/hreflang-checks.js').AlternateCheck} AlternateCheck
 * @typedef {{
 *   pageUrl: string,
 *   canonical: string | null,
 *   htmlLang: string | null,
 *   contentLanguage: string | null,
 *   ogLocale: string | null,
 *   alternates: Array<{hreflang: string, href: string}>,
 *   checks: {state: 'checked' | 'disabled' | 'none', reason: string | null, results: AlternateCheck[], notChecked: number},
 * }} HreflangDataArtifact
 */

const LIMIT_ENV = 'LHCI_SEO_HREFLANG_MAX_CHECKS';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/* c8 ignore start */
function collectInPage() {
  const first = (/** @type {string} */ selector, /** @type {string} */ attr) => {
    const el = document.querySelector(selector);
    const value = el && el.getAttribute(attr);
    return value ? value.slice(0, 200) : null;
  };
  const seen = new Set();
  const alternates = [];
  for (const el of Array.from(
    document.querySelectorAll('head link[rel~="alternate" i][hreflang]')
  )) {
    const link = /** @type {HTMLLinkElement} */ (el);
    const hreflang = (link.getAttribute('hreflang') || '').trim().slice(0, 40);
    const href = link.href;
    const key = `${hreflang.toLowerCase()}\n${href}`;
    if (!hreflang || !href || seen.has(key)) continue;
    seen.add(key);
    alternates.push({hreflang, href: href.slice(0, 2000)});
    if (alternates.length >= 100) break;
  }
  const canonical = document.querySelector('head link[rel~="canonical" i]');
  return {
    pageUrl: location.href,
    canonical: canonical ? /** @type {HTMLLinkElement} */ (canonical).href : null,
    htmlLang: document.documentElement.getAttribute('lang'),
    contentLanguage: first('meta[http-equiv="content-language" i]', 'content'),
    ogLocale: first('meta[property="og:locale"]', 'content'),
    alternates,
  };
}
/* c8 ignore stop */

/**
 * @param {string | undefined} value
 * @return {number}
 */
function limitFrom(value) {
  if (value === undefined || value.trim() === '') return DEFAULT_LIMIT;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

/**
 * @param {Omit<HreflangDataArtifact, 'checks'>} page What was read in the browser.
 * @param {{env?: NodeJS.ProcessEnv, check?: typeof checkAlternates}} [deps] Injectable so tests never touch the
 *   network.
 * @return {Promise<HreflangDataArtifact>}
 */
async function collectHreflangData(page, {env = process.env, check = checkAlternates} = {}) {
  const alternates = Array.isArray(page.alternates) ? page.alternates : [];
  /** @type {HreflangDataArtifact['checks']} */
  let checks = {
    state: 'none',
    reason: 'The page declares no hreflang links.',
    results: [],
    notChecked: 0,
  };
  if (alternates.length > 0) {
    const limit = limitFrom(env[LIMIT_ENV]);
    if (limit === 0) {
      checks = {
        state: 'disabled',
        reason: `The requests to the alternate versions are switched off (${LIMIT_ENV}=0).`,
        results: [],
        notChecked: 0,
      };
    } else {
      const {results, notChecked} = await check({pageUrl: page.pageUrl, alternates, limit});
      checks = {state: 'checked', reason: null, results, notChecked};
    }
  }
  return {...page, alternates, checks};
}

class HreflangData extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<HreflangDataArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const page = await passContext.driver.executionContext.evaluate(collectInPage, {
      args: [],
      useIsolation: true,
      deps: [],
    });
    return collectHreflangData(page);
  }
}

export default HreflangData;
export {collectHreflangData, collectInPage, limitFrom, LIMIT_ENV, DEFAULT_LIMIT, MAX_LIMIT};
