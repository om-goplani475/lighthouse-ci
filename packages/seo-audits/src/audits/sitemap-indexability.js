/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the `urlSample` section of the `SitemapDocuments` artifact (see
 * `../gatherers/sitemap-documents.js`); makes no request of its own. A sitemap asks search engines
 * to index its URLs, so a listed page that says "do not index me" (noindex) or "index a different
 * URL instead" (a canonical elsewhere) contradicts it.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {noindexFor} from '../lib/robots-directives.js';

const UIStrings = {
  title: 'Sampled sitemap URLs are indexable',
  failureTitle: 'Some sampled sitemap URLs say they should not be indexed',
  description:
    'A sitemap asks search engines to index its URLs, so a listed page that is `noindex` (by an ' +
    '`X-Robots-Tag` header or a `<meta name="robots">` tag, including ones aimed only at Googlebot ' +
    'or Bingbot) or whose `<link rel="canonical">` points to a different URL contradicts it: list ' +
    'the canonical version instead. A canonical that differs only by a trailing slash is noted, not ' +
    'failed. This is a spot check of the same evenly spread sample as `sitemap-url-status` (not every ' +
    'URL), and only pages that returned 2xx are judged. It reads the raw HTML head of a plain ' +
    'request, so a noindex or canonical added by client-side JavaScript is not seen. Blocking by ' +
    "robots.txt is `sitemap-robots-crossref`'s check. Not-applicable when no sitemap URL list could " +
    'be sampled.',
};

const MAX_ROWS = 20;
const CRAWLERS = /** @type {Array<'googlebot' | 'bingbot'>} */ (['googlebot', 'bingbot']);
const CRAWLER_LABEL = {googlebot: 'Googlebot', bingbot: 'Bingbot'};

/** @typedef {import('../lib/sitemap-parse.js').SampledPage} SampledPage */

/**
 * @param {URL} url
 * @return {string} The URL without its fragment.
 */
function withoutFragment(url) {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

/**
 * @param {string} href
 * @return {string} The URL with a trailing slash on a non-root path removed.
 */
function withoutTrailingSlash(href) {
  const url = new URL(href);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

/**
 * Classifies a page's canonical(s) relative to the page's own URL.
 * @param {SampledPage} page
 * @return {{kind: 'none' | 'self' | 'trailing-slash' | 'conflicting' | 'elsewhere', target?: string}}
 */
function classifyCanonical(page) {
  /** @type {Set<string>} */
  const resolved = new Set();
  for (const href of page.canonicals) {
    try {
      resolved.add(withoutFragment(new URL(href, page.url)));
    } catch {
      // An href that cannot be resolved is ignored: not a usable canonical.
    }
  }
  if (resolved.size === 0) return {kind: 'none'};
  if (resolved.size > 1) return {kind: 'conflicting'};

  const target = [...resolved][0];
  const self = withoutFragment(new URL(page.url));
  if (target === self) return {kind: 'self'};
  if (withoutTrailingSlash(target) === withoutTrailingSlash(self)) {
    return {kind: 'trailing-slash', target};
  }
  return {kind: 'elsewhere', target};
}

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class SitemapIndexability extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'sitemap-indexability',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SitemapDocuments'],
    };
  }

  /**
   * @param {{SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {discovery, urlSample} = artifacts.SitemapDocuments;
    if (discovery === 'none' || discovery === 'unavailable' || !urlSample) {
      return {score: null, notApplicable: true};
    }

    const judged = urlSample.pages.filter(
      p => !p.notChecked && !p.error && p.status !== null && p.status >= 200 && p.status < 300
    );
    if (judged.length === 0) {
      return {score: null, notApplicable: true};
    }

    /** @type {Array<{url: string, problem: string}>} */
    const rows = [];
    let noindexCount = 0;
    let canonicalCount = 0;
    let trailingSlash = 0;
    let conflicting = 0;
    let headNotRead = 0;
    let compressed = 0;
    let nonHtml = 0;

    for (const page of judged) {
      const blocked = noindexFor(CRAWLERS, {metas: page.metas, xRobotsTag: page.xRobotsTag});
      if (blocked.length) {
        noindexCount += 1;
        const who = blocked.map(b => CRAWLER_LABEL[b.crawler]).join(' and ');
        const sources = [...new Set(blocked.flatMap(b => b.via))].join(' and ');
        rows.push({url: page.url, problem: `noindex for ${who} (${sources})`});
      } else if (page.bodyRead === 'html' && !page.headComplete) {
        // No noindex was found, but the head was not read in full, so that is not proof.
        headNotRead += 1;
      }

      if (page.bodyRead === 'skipped-compressed') compressed += 1;
      if (page.bodyRead === 'skipped-not-html') nonHtml += 1;

      const canonical = classifyCanonical(page);
      if (canonical.kind === 'elsewhere') {
        canonicalCount += 1;
        rows.push({url: page.url, problem: `canonical points to ${canonical.target}`});
      } else if (canonical.kind === 'trailing-slash') {
        trailingSlash += 1;
      } else if (canonical.kind === 'conflicting') {
        conflicting += 1;
      }
    }

    const notJudged = urlSample.pages.length - judged.length;
    const notes = [
      `Checked ${judged.length} of ${urlSample.eligibleCount} listed URLs (a sample).`,
    ];
    if (trailingSlash) {
      notes.push(`${trailingSlash} canonical(s) differ from the URL only by a trailing slash.`);
    }
    if (conflicting) {
      notes.push(`${conflicting} page(s) declare conflicting canonicals (not judged).`);
    }
    if (headNotRead) {
      notes.push(
        `${headNotRead} page(s) had their <head> only partly read, so no noindex is not proof.`
      );
    }
    if (compressed) {
      notes.push(
        `${compressed} page(s) were compressed: only their X-Robots-Tag header was checked.`
      );
    }
    if (nonHtml) {
      notes.push(`${nonHtml} non-HTML page(s): only their X-Robots-Tag header was checked.`);
    }
    if (notJudged) {
      notes.push(
        `${notJudged} sampled URL(s) did not return 2xx or were not checked (see sitemap-url-status).`
      );
    }
    const note = notes.join(' ');

    if (rows.length === 0) {
      return {score: 1, displayValue: note};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'url', valueType: 'text', label: 'URL'},
      {key: 'problem', valueType: 'text', label: 'Problem'},
    ];
    const parts = [];
    if (noindexCount) parts.push(`${noindexCount} noindex`);
    if (canonicalCount) parts.push(`${canonicalCount} with a canonical pointing elsewhere`);
    const more = rows.length > MAX_ROWS ? ` (showing the first ${MAX_ROWS})` : '';
    return {
      score: 0,
      explanation: `${parts.join(', ')} among ${judged.length} judged URL(s)${more}. ${note}`,
      details: Audit.makeTableDetails(headings, rows.slice(0, MAX_ROWS)),
    };
  }
}

export default SitemapIndexability;
export {UIStrings};
