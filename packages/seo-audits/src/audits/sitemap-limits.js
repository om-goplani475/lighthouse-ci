/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the `SitemapDocuments` artifact (see `../gatherers/sitemap-documents.js`); fetches nothing.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'XML sitemap is within the protocol size limits',
  failureTitle: 'XML sitemap exceeds a protocol size limit',
  description:
    'The sitemaps.org protocol, which Google enforces, allows at most 50,000 URLs and 50 MiB ' +
    'uncompressed per sitemap file (and 50,000 child sitemaps per index); anything beyond that is ' +
    'ignored. Larger sites should split into several files under a sitemap index. The table lists ' +
    'every checked file with its size and entry count, gzip or not. A run checks at most 10 ' +
    'sitemap files, and only part of a very large file may be read; when that happens the result ' +
    'says so rather than treating the unchecked part as passing. Not-applicable when no sitemap ' +
    'could be discovered or fetched.',
};

const MAX_ENTRIES = 50_000;
const MAX_BYTES_LABEL = '50 MiB';

/** @typedef {import('../lib/sitemap-parse.js').SitemapDocument} SitemapDocument */

/**
 * @param {number} bytes
 * @return {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * @param {SitemapDocument} doc
 * @return {{overEntries: boolean, overBytes: boolean}}
 */
function limitStatus(doc) {
  return {
    overEntries: doc.entryCount > MAX_ENTRIES,
    overBytes: doc.exceededUncompressedLimit,
  };
}

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class SitemapLimits extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'sitemap-limits',
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
    const {discovery, documents, documentsTruncated} = artifacts.SitemapDocuments;
    if (discovery === 'none' || discovery === 'unavailable') {
      return {score: null, notApplicable: true};
    }

    // A document that could not be fetched or decompressed has no size to judge.
    const measured = documents.filter(doc => doc.outcome === 'ok');
    if (measured.length === 0) {
      return {score: null, notApplicable: true};
    }

    const rows = measured.map(doc => {
      const {overEntries, overBytes} = limitStatus(doc);
      const parsed = doc.kind !== null;
      const size = overBytes
        ? `over ${MAX_BYTES_LABEL} uncompressed`
        : doc.gzip
        ? `${formatBytes(doc.compressedBytes)} gzip, ${formatBytes(
            doc.uncompressedBytes
          )} uncompressed`
        : formatBytes(doc.uncompressedBytes);
      const reasons = [];
      if (overEntries) reasons.push(`over ${MAX_ENTRIES.toLocaleString('en-US')} entries`);
      if (overBytes) reasons.push(`over ${MAX_BYTES_LABEL}`);
      return {
        url: doc.url,
        type:
          doc.kind === 'urlset'
            ? 'Sitemap'
            : doc.kind === 'sitemapindex'
            ? 'Sitemap index'
            : 'Not parsed',
        entries: !parsed
          ? 'not counted'
          : doc.entriesTruncated
          ? `over ${MAX_ENTRIES.toLocaleString('en-US')}`
          : String(doc.entryCount),
        size,
        gzip: doc.gzip ? 'Yes' : 'No',
        limit: reasons.length ? `Exceeded: ${reasons.join(', ')}` : 'Within limits',
      };
    });

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'url', valueType: 'text', label: 'Sitemap'},
      {key: 'type', valueType: 'text', label: 'Type'},
      {key: 'entries', valueType: 'text', label: 'Entries'},
      {key: 'size', valueType: 'text', label: 'Size'},
      {key: 'gzip', valueType: 'text', label: 'Gzip'},
      {key: 'limit', valueType: 'text', label: 'Limit status'},
    ];
    const details = Audit.makeTableDetails(headings, rows);

    const coverageNote = documentsTruncated
      ? ` Only the first ${documents.length} sitemap files were checked; the rest were not.`
      : '';

    const failing = measured.filter(doc => {
      const {overEntries, overBytes} = limitStatus(doc);
      return overEntries || overBytes;
    });
    if (failing.length === 0) {
      return coverageNote
        ? {score: 1, details, displayValue: coverageNote.trim()}
        : {score: 1, details};
    }
    return {
      score: 0,
      explanation: `${failing.length} sitemap file(s) exceed a limit.${coverageNote}`,
      details,
    };
  }
}

export default SitemapLimits;
export {UIStrings};
