/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the `SitemapDocuments` artifact (see `../gatherers/sitemap-documents.js`); this audit
 * fetches nothing itself. Checks each discovered sitemap is reachable and a well-formed sitemap
 * document. Duplicate URLs and size limits are separate audits on the same artifact.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {SITEMAP_NAMESPACE} from '../lib/sitemap-parse.js';

const UIStrings = {
  title: 'XML sitemap is valid',
  failureTitle: 'XML sitemap has problems',
  description:
    'Checks each sitemap declared in robots.txt (or found at `/sitemap.xml` when none is ' +
    'declared, and the child sitemaps of a sitemap index, one level deep) is reachable, is ' +
    'well-formed XML, has a `<urlset>` or `<sitemapindex>` root in the sitemaps.org namespace, ' +
    'and lists only absolute http(s) URLs. A sitemap URL that redirects is reported rather than ' +
    'followed: declare the final URL. Not-applicable when no sitemap could be discovered (a ' +
    "missing declaration is `robots-txt-sitemap-declared`'s concern) or robots.txt could not be " +
    'retrieved.',
};

const MAX_LOC_EXAMPLES = 3;

/** @typedef {import('../lib/sitemap-parse.js').SitemapDocument} SitemapDocument */

/**
 * @param {SitemapDocument} doc
 * @return {Array<{problem: string, detail: string, transient?: boolean}>} A `transient` problem (a timeout, a
 *   network error, bot protection or a server error) says nothing about the sitemap itself: it is a note.
 */
function problemsFor(doc) {
  switch (doc.outcome) {
    case 'http-error':
      return [
        {
          problem: 'Sitemap could not be fetched',
          detail: `HTTP ${doc.status}`,
          transient:
            doc.status === 401 ||
            doc.status === 403 ||
            doc.status === 408 ||
            doc.status === 429 ||
            Number(doc.status) >= 500,
        },
      ];
    case 'redirect':
      return [
        {
          problem: 'Sitemap URL redirects',
          detail: `HTTP ${doc.status} to ${
            doc.redirectLocation || '(no Location header)'
          }. Declare the final URL instead.`,
        },
      ];
    case 'network-error':
      return [
        {
          problem: 'Sitemap could not be fetched',
          detail: doc.errorMessage || 'network error',
          transient: true,
        },
      ];
    case 'decompression-error':
      return [{problem: 'Sitemap could not be decompressed', detail: doc.errorMessage || ''}];
    default:
  }

  // Over the size cap: the document was never parsed. That is `sitemap-limits`' finding, and
  // nothing here can be concluded about its contents.
  if (doc.kind === null) return [];

  if (doc.parseError) {
    const {message, line, column} = doc.parseError;
    return [
      {problem: 'XML is not well-formed', detail: `${message} (line ${line}, column ${column})`},
    ];
  }

  /** @type {Array<{problem: string, detail: string}>} */
  const problems = [];
  if (doc.kind === 'invalid') {
    problems.push({
      problem: 'Root element is not a sitemap',
      detail: 'The root must be <urlset> or <sitemapindex>.',
    });
    return problems;
  }
  if (!doc.namespaceOk) {
    problems.push({
      problem: 'Missing or incorrect XML namespace',
      detail: `The root element must declare xmlns="${SITEMAP_NAMESPACE}".`,
    });
  }
  if (doc.invalidLocCount > 0) {
    const examples = doc.invalidLocs
      .slice(0, MAX_LOC_EXAMPLES)
      .map(loc => `"${loc.value}" (${loc.reason})`)
      .join('; ');
    problems.push({
      problem: `${doc.invalidLocCount} invalid <loc> value(s)`,
      detail: examples,
    });
  }
  return problems;
}

// @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class SitemapValid extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'sitemap-valid',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - SitemapDocuments isn't part of Lighthouse's own closed Artifacts type
      // from an out-of-tree package — same boundary documented in the other audits here.
      requiredArtifacts: ['SitemapDocuments'],
    };
  }

  /**
   * @param {{SitemapDocuments: import('../lib/sitemap-parse.js').SitemapDocumentsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {discovery, documents, ignoredSitemapLines} = artifacts.SitemapDocuments;
    if (discovery === 'none' || discovery === 'unavailable') {
      return {score: null, notApplicable: true};
    }

    /** @type {Array<{url: string, problem: string, detail: string}>} */
    const failures = [];
    /** @type {Array<{url: string, problem: string, detail: string}>} */
    const transient = [];
    for (const doc of documents) {
      for (const {problem, detail, transient: isTransient} of problemsFor(doc)) {
        if (isTransient) {
          transient.push({url: doc.url, problem: `${problem} (not judged)`, detail});
        } else {
          failures.push({url: doc.url, problem, detail});
        }
      }
    }

    // Ignored robots.txt lines are worth showing but are not a sitemap defect: the sitemap
    // itself may be fine. (`robots-txt-sitemap-declared` flags a file whose lines are *all* bad.)
    const notes = ignoredSitemapLines.map(line => ({
      url: line,
      problem: 'robots.txt Sitemap line ignored (not an absolute http(s) URL)',
      detail: 'Not checked.',
    }));

    const rows = [...failures, ...transient, ...notes];
    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'url', valueType: 'text', label: 'Sitemap'},
      {key: 'problem', valueType: 'text', label: 'Problem'},
      {key: 'detail', valueType: 'text', label: 'Detail'},
    ];
    const details = rows.length ? Audit.makeTableDetails(headings, rows) : undefined;

    if (failures.length === 0) {
      return details
        ? {
            score: 1,
            displayValue: transient.length
              ? `${transient.length} sitemap(s) could not be fetched (a timeout, bot protection or a server error; not judged)`
              : undefined,
            details,
          }
        : {score: 1};
    }
    return {
      score: 0,
      explanation: `${failures.length} sitemap problem(s) found.`,
      details,
    };
  }
}

export default SitemapValid;
export {UIStrings};
