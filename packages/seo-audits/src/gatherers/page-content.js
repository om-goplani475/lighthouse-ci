/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Collects what the content audits read from the live page: the visible text of the main content (the largest of
 * `main`, `article` and `[role=main]`, else the body), text hidden by styling tricks (tiny font, off-screen,
 * the same colour as its background), the dates the page declares, and its title, headings and `lang`. Rule-agnostic:
 * the judging is in lib/content-*.js. No request. Capped everywhere so a huge page cannot grow the artifact.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';

/* eslint-env browser */

/**
 * @typedef {{
 *   url: string,
 *   lang: string | null,
 *   title: string,
 *   h1: string[],
 *   text: string,
 *   textTruncated: boolean,
 *   hiddenWords: number,
 *   hiddenSamples: Array<{reason: string, text: string}>,
 *   metaDates: Array<{key: string, value: string}>,
 *   times: Array<{datetime: string, text: string}>,
 * }} PageContentArtifact
 */

/* c8 ignore start */
function collectPageContent() {
  const MAX_TEXT = 200000;
  const MAX_ELEMENTS = 4000;
  const clip = (/** @type {string} */ s, /** @type {number} */ n) =>
    s.replace(/\s+/g, ' ').trim().slice(0, n);

  // The main content: the biggest of main / article / [role=main], else the whole body.
  let root = document.body;
  let best = 0;
  for (const el of Array.from(document.querySelectorAll('main, article, [role="main"]'))) {
    const len = /** @type {HTMLElement} */ (el).innerText
      ? /** @type {HTMLElement} */ (el).innerText.length
      : 0;
    if (len > best) {
      best = len;
      root = /** @type {HTMLElement} */ (el);
    }
  }
  const raw = (root && root.innerText) || '';
  const text = raw.slice(0, MAX_TEXT);

  // Text hidden by styling tricks (not by display:none or an accordion, which are ordinary).
  let hiddenWords = 0;
  /** @type {Array<{reason: string, text: string}>} */
  const hiddenSamples = [];
  const bgOf = (/** @type {Element | null} */ el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    return 'rgb(255, 255, 255)';
  };
  let seen = 0;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (++seen > MAX_ELEMENTS) break;
    if (el.closest('details, [hidden], script, style, noscript, template, svg')) continue;
    let own = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) own += node.nodeValue || '';
    }
    own = clip(own, 400);
    if (own.length < 20) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    const screenReaderOnly =
      (rect.width <= 1 && rect.height <= 1) ||
      /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(s.clip);
    if (screenReaderOnly) continue;
    /** @type {string | null} */
    let reason = null;
    if (parseFloat(s.fontSize) <= 2) reason = 'a font size of 2 px or less';
    else if (parseFloat(s.textIndent) <= -999) {
      reason = 'pushed off the left edge with a negative indent';
    } else if (rect.right < -500 || rect.bottom < -500) reason = 'positioned off the screen';
    else if (s.color === bgOf(el)) reason = 'the same colour as its background';
    else if (parseFloat(s.opacity) === 0) reason = 'fully transparent';
    if (reason) {
      hiddenWords += own.split(' ').length;
      if (hiddenSamples.length < 5) hiddenSamples.push({reason, text: own.slice(0, 80)});
    }
  }

  const metaDates = [];
  const metaSelectors = [
    ['meta[property="article:published_time"]', 'article:published_time'],
    ['meta[property="article:modified_time"]', 'article:modified_time'],
    ['meta[name="date"]', 'date'],
    ['meta[name="last-modified"]', 'last-modified'],
    ['meta[itemprop="datePublished"]', 'datePublished'],
    ['meta[itemprop="dateModified"]', 'dateModified'],
  ];
  for (const [selector, key] of metaSelectors) {
    const el = document.querySelector(selector);
    const value = el && el.getAttribute('content');
    if (value) metaDates.push({key, value: value.slice(0, 60)});
  }
  const times = Array.from(document.querySelectorAll('time[datetime]'))
    .slice(0, 20)
    .map(t => ({
      datetime: (t.getAttribute('datetime') || '').slice(0, 60),
      text: clip(t.textContent || '', 40),
    }));

  return {
    url: location.href,
    lang: document.documentElement.getAttribute('lang'),
    title: clip(document.title || '', 300),
    h1: Array.from(document.querySelectorAll('h1'))
      .slice(0, 5)
      .map(h => clip(h.textContent || '', 200)),
    text,
    textTruncated: raw.length > MAX_TEXT,
    hiddenWords,
    hiddenSamples,
    metaDates,
    times,
  };
}
/* c8 ignore stop */

class PageContent extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<PageContentArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    return passContext.driver.executionContext.evaluate(collectPageContent, {
      args: [],
      useIsolation: true,
      deps: [],
    });
  }
}

export default PageContent;
