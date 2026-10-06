/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the `SitemapDocuments` artifact (see `../gatherers/sitemap-documents.js`); fetches nothing.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'Duplicate URLs in the XML sitemap',
  failureTitle: 'XML sitemap lists the same URL more than once',
  description:
    'Informational (never fails a build). A URL listed twice in one sitemap wastes crawl budget and usually points to a bug in how the ' +
    'sitemap is generated. Search engines tolerate duplicates, so this is a hygiene check. URLs ' +
    'are compared as exact strings: `/a` and `/a/`, or differing letter case, are different URLs ' +
    'and are not flagged, since they are not equivalent in general. Each sitemap file is checked ' +
    'on its own; the same URL appearing in two different sitemap files is not flagged. ' +
    'Not-applicable when no sitemap URL list could be checked.',
};

const MAX_ROWS = 20;

/** @typedef {import('../lib/sitemap-parse.js').SitemapDocument} SitemapDocument */

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class SitemapDuplicateUrls extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'sitemap-duplicate-urls',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SitemapDocuments'],
    };
  }

  /**
   * @param {{SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {discovery, documents} = artifacts.SitemapDocuments;
    if (discovery === 'none' || discovery === 'unavailable') {
      return {score: null, notApplicable: true};
    }

    // Only a fetched, parsed URL list can be checked. A sitemap index lists child sitemaps, not
    // page URLs, so it is skipped too.
    const checkable = documents.filter(doc => doc.outcome === 'ok' && doc.kind === 'urlset');
    if (checkable.length === 0) {
      return {score: null, notApplicable: true};
    }

    /** @type {Array<{sitemap: string, url: string, count: number}>} */
    const duplicates = [];
    for (const doc of checkable) {
      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const loc of doc.locs) counts.set(loc, (counts.get(loc) || 0) + 1);
      for (const [loc, count] of counts) {
        if (count > 1) duplicates.push({sitemap: doc.url, url: loc, count});
      }
    }

    const partial = checkable
      .filter(doc => doc.entriesTruncated)
      .map(doc => `only the first ${doc.locs.length} URLs of ${doc.url} were checked`);
    const partialNote = partial.length ? ` Note: ${partial.join('; ')}.` : '';

    if (duplicates.length === 0) {
      return partial.length ? {score: 1, displayValue: partialNote.trim()} : {score: 1};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'sitemap', valueType: 'text', label: 'Sitemap'},
      {key: 'url', valueType: 'text', label: 'Duplicated URL'},
      {key: 'count', valueType: 'numeric', label: 'Times listed'},
    ];
    const shown = duplicates.slice(0, MAX_ROWS);
    const more = duplicates.length > MAX_ROWS ? ` (showing the first ${MAX_ROWS})` : '';
    return {
      score: 0,
      displayValue: `${duplicates.length} duplicate URL(s)`,
      explanation: `${duplicates.length} URL(s) are listed more than once${more}.${partialNote}`,
      details: Audit.makeTableDetails(headings, shown),
    };
  }
}

export default SitemapDuplicateUrls;
export {UIStrings};
