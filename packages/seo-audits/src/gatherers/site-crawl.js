/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gatherer for the site crawler (see ../lib/crawler.js for what the crawl does and every bound on it, and
 * docs/audit-specs/site-crawler.md for the design). In the browser it reads two things from the live page:
 * the page's own same-origin links (the crawl's second seed source) and how much visible text the rendered
 * page has, so an audit can tell a page whose content is built by script from the server HTML the crawler
 * sees. Everything else happens on the Node side in `crawlSite`, which never throws.
 *
 * Lighthouse only runs this gatherer when a selected audit needs the `SiteCrawl` artifact, so a run limited to
 * Lighthouse's own categories does not crawl.
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {crawlSite} from '../lib/crawler.js';

/* eslint-env browser */

/** @typedef {import('../lib/crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */

const MAX_PAGE_LINKS = 200;

/* c8 ignore start */
function collectInPage() {
  const origin = location.origin;
  /** @type {string[]} */
  const links = [];
  const seen = new Set();
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = /** @type {HTMLAnchorElement} */ (a).href;
    if (!href || seen.has(href)) continue;
    try {
      if (new URL(href).origin !== origin) continue;
    } catch {
      continue;
    }
    seen.add(href);
    links.push(href);
    if (links.length >= 200) break;
  }
  const text = (document.body && document.body.innerText) || '';
  return {links, renderedTextLength: text.replace(/\s+/g, ' ').trim().length};
}
/* c8 ignore stop */

/**
 * @param {{links: string[], renderedTextLength: number | null}} page What was read in the browser.
 * @param {string} auditedUrl
 * @param {Partial<Parameters<typeof crawlSite>[0]>} [deps] Passed to `crawlSite`; injectable so tests
 *   never touch the network or the disk.
 * @return {Promise<SiteCrawlArtifact>}
 */
async function collectSiteCrawl(page, auditedUrl, deps = {}) {
  const links = Array.isArray(page.links) ? page.links.slice(0, MAX_PAGE_LINKS) : [];
  const artifact = await crawlSite({auditedUrl, pageLinks: links, ...deps});
  artifact.auditedRenderedTextLength =
    typeof page.renderedTextLength === 'number' ? page.renderedTextLength : null;
  return artifact;
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {string | null} A run warning, or null when the crawl ran (or was switched off on purpose).
 */
function skippedWarning(artifact) {
  if (artifact.state === 'unavailable' && artifact.reason) {
    return `The site crawl could not run: ${artifact.reason}`;
  }
  const snapshot = artifact.snapshot;
  if (snapshot && snapshot.robots.state === 'unavailable') {
    return (
      'robots.txt could not be read, so the site crawl requested only the audited page ' +
      '(it does not guess what robots.txt would have allowed)'
    );
  }
  return null;
}

class SiteCrawl extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<SiteCrawlArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  async getArtifact(passContext) {
    const page = await passContext.driver.executionContext.evaluate(collectInPage, {
      args: [],
      useIsolation: true,
      deps: [],
    });
    const artifact = await collectSiteCrawl(page, passContext.baseArtifacts.URL.finalDisplayedUrl);
    const warning = skippedWarning(artifact);
    if (warning) passContext.baseArtifacts.LighthouseRunWarnings.push(warning);
    return artifact;
  }
}

export default SiteCrawl;
export {collectSiteCrawl, collectInPage, skippedWarning};
