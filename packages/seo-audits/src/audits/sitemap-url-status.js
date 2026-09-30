/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the `SitemapDocuments` artifact (see `../gatherers/sitemap-documents.js`) and requests a
 * bounded sample of the URLs it lists. This audit is the one part of the sitemap group that talks
 * to the audited site's *pages*, through `../lib/safe-fetch.js`'s `safeFetchStatus` (SSRF-protected,
 * no redirects followed, no body read). It is not a crawler: see `../lib/sitemap-url-sample.js`.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {safeFetchStatus} from '../lib/safe-fetch.js';
import {
  SAMPLE_SIZE_ENV,
  MAX_SAMPLE_SIZE,
  DEFAULT_SAMPLE_SIZE,
  resolveSampleSize,
  pickEvenly,
  collectEligibleUrls,
  checkUrls,
  describeCheck,
} from '../lib/sitemap-url-sample.js';

const UIStrings = {
  title: 'Sampled sitemap URLs return HTTP 200',
  failureTitle: 'Some sampled sitemap URLs do not return HTTP 200',
  description:
    `Requests a sample of the URLs your sitemap lists (${DEFAULT_SAMPLE_SIZE} by default, up to ` +
    `${MAX_SAMPLE_SIZE} with the ${SAMPLE_SIZE_ENV} environment variable) and checks each ` +
    'returns 200. A sitemap should list final, indexable URLs: an entry that redirects, returns ' +
    '4xx/5xx, or cannot be reached wastes crawl budget and signals a stale sitemap. The sample is ' +
    'evenly spread across the listed URLs (first and last included) and identical on every run, so ' +
    'it is a spot check, not proof every URL is healthy. Only URLs on the same host as their ' +
    'sitemap are requested. Redirects are reported, not followed. Status only: whether a page ' +
    'is `noindex` is not checked here. Not-applicable when no sitemap URL list could be checked.',
};

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class SitemapUrlStatus extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'sitemap-url-status',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SitemapDocuments'],
    };
  }

  /**
   * @param {{SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts) {
    const {discovery, documents} = artifacts.SitemapDocuments;
    if (discovery === 'none' || discovery === 'unavailable') {
      return {score: null, notApplicable: true};
    }

    const {urls, skippedCrossOrigin} = collectEligibleUrls(documents);
    if (urls.length === 0) {
      return {score: null, notApplicable: true};
    }

    const sample = pickEvenly(urls, resolveSampleSize());
    const checks = await checkUrls(sample, {fetchStatus: safeFetchStatus});

    const checked = checks.filter(c => !c.notChecked);
    const failures = checked.filter(
      c => c.error || c.status === null || c.status < 200 || c.status >= 300
    );
    const notChecked = checks.length - checked.length;

    const notes = [`Checked ${checked.length} of ${urls.length} listed URLs (a sample).`];
    if (notChecked) notes.push(`${notChecked} not checked: the time budget ran out.`);
    if (skippedCrossOrigin) {
      notes.push(`${skippedCrossOrigin} listed on another host were not requested.`);
    }
    const note = notes.join(' ');

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'url', valueType: 'text', label: 'URL'},
      {key: 'result', valueType: 'text', label: 'Result'},
    ];
    const details = Audit.makeTableDetails(
      headings,
      checks.map(check => ({url: check.url, result: describeCheck(check)}))
    );

    if (failures.length === 0) {
      return {score: 1, details, displayValue: note};
    }
    return {
      score: 0,
      explanation: `${failures.length} of ${checked.length} sampled URL(s) did not return 200. ${note}`,
      details,
    };
  }
}

export default SitemapUrlStatus;
export {UIStrings};
