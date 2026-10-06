/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the `SitemapDocuments` artifact (see `../gatherers/sitemap-documents.js`) and Lighthouse
 * core's own `RobotsTxt` artifact; fetches nothing. See `../lib/sitemap-robots-crossref.js`.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {robotsTxtState} from '../lib/robots-txt.js';
import {crossReference, MAX_ROWS} from '../lib/sitemap-robots-crossref.js';

const UIStrings = {
  title: 'Sitemap URLs are not blocked by robots.txt',
  failureTitle: 'robots.txt blocks URLs listed in the sitemap',
  description:
    'A sitemap asks search engines to index its URLs; robots.txt tells them not to crawl some ' +
    'paths. A URL that is both listed and disallowed contradicts itself: the page cannot be ' +
    'crawled, so it will not be indexed as intended. Every same-origin URL the sitemap lists is ' +
    'checked (not a sample) against robots.txt for Googlebot and Bingbot; robots.txt only governs ' +
    'its own origin, so URLs on other hosts are not checked. Also flags a sitemap whose own path ' +
    'robots.txt disallows (search engines differ on whether they apply robots.txt to sitemap ' +
    'files, so treat that as a warning to verify, not proof it is ignored). Whether the audited ' +
    'page is listed in the sitemap is shown for information and never affects the result: many ' +
    'pages are legitimately left out. Not-applicable when no sitemap URL list or robots.txt could ' +
    'be read.',
};

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class SitemapRobotsCrossref extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'sitemap-robots-crossref',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      supportedModes: ['navigation'],
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SitemapDocuments', 'RobotsTxt', 'URL'],
    };
  }

  /**
   * @param {{
   *   SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact,
   *   RobotsTxt: import('../lib/robots-txt.js').RobotsTxtArtifact,
   *   URL: {finalDisplayedUrl: string},
   * }} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {discovery, documents} = artifacts.SitemapDocuments;
    if (discovery === 'none' || discovery === 'unavailable') {
      return {score: null, notApplicable: true};
    }

    const robotsState = robotsTxtState(artifacts.RobotsTxt);
    if (robotsState === 'unavailable') {
      return {score: null, notApplicable: true};
    }
    // No robots.txt means nothing is disallowed: every listed URL is crawlable.
    const robotsContent = robotsState === 'present' ? artifacts.RobotsTxt.content || '' : '';

    const pageUrl = artifacts.URL.finalDisplayedUrl;
    const result = crossReference({robotsContent, pageUrl, documents});

    if (result.checked === 0 && result.blockedSitemaps.length === 0) {
      return {score: null, notApplicable: true};
    }

    const notes = [`Checked ${result.checked} sitemap URL(s) against robots.txt.`];
    if (result.skippedCrossOrigin) {
      notes.push(`${result.skippedCrossOrigin} on another host were not checked.`);
    }
    if (result.pageListed !== null) {
      notes.push(
        result.pageListed
          ? 'The audited page is listed in the sitemap.'
          : 'The audited page is not listed in the sitemap (informational only).'
      );
    }
    const note = notes.join(' ');

    if (result.blockedTotal === 0 && result.blockedSitemaps.length === 0) {
      return {score: 1, displayValue: note};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'url', valueType: 'text', label: 'URL'},
      {key: 'problem', valueType: 'text', label: 'Problem'},
    ];
    const rows = [
      ...result.blockedSitemaps.map(s => ({
        url: s.url,
        problem: `The sitemap's own path is disallowed by robots.txt for ${s.crawlers.join(
          ' and '
        )}`,
      })),
      ...result.blockedUrls.map(u => ({
        url: u.url,
        problem: `Listed in the sitemap but disallowed by robots.txt for ${u.crawlers.join(
          ' and '
        )}`,
      })),
    ];

    const problems = [];
    if (result.blockedTotal) {
      const more = result.blockedTotal > MAX_ROWS ? ` (showing the first ${MAX_ROWS})` : '';
      problems.push(
        `${result.blockedTotal} of ${result.checked} sitemap URL(s) are disallowed by robots.txt${more}`
      );
    }
    if (result.blockedSitemaps.length) {
      problems.push(`${result.blockedSitemaps.length} sitemap file path(s) are disallowed`);
    }
    return {
      score: 0,
      explanation: `${problems.join('; ')}. ${note}`,
      details: Audit.makeTableDetails(headings, rows),
    };
  }
}

export default SitemapRobotsCrossref;
export {UIStrings};
