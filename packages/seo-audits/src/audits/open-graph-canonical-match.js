/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `og:url` is meant to be "the canonical URL of your object" (per ogp.me) — a mismatch against
 * the page's actual `<link rel="canonical">` tells search/social crawlers two different things
 * about which URL is the "real" one. Not-applicable when either is absent: `og:url` presence is
 * `open-graph-completeness`'s concern, and canonical presence/validity is Lighthouse core's own
 * `canonical` audit's concern — this audit only compares the two when both already exist.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: '`og:url` matches the canonical URL',
  failureTitle: '`og:url` does not match the canonical URL',
  description:
    'The Open Graph protocol defines `og:url` as the canonical URL of the page. When its host or path ' +
    'disagrees with the page\'s own `<link rel="canonical">`, search and social crawlers are ' +
    'told two different "real" URLs for the same content. A difference in the trailing slash or the query ' +
    'string only (often a tracking parameter) is a note, not a failure.',
};

/**
 * @param {string} href
 * @return {{page: string, query: string} | null} the page (protocol, host and path with the trailing slash
 *   stripped) and the query string, or null if unparseable
 */
function normalize(href) {
  try {
    const url = new URL(href);
    // A loop, not /\/+$/: that pattern is quadratic on a long run of slashes.
    let end = url.pathname.length;
    while (end > 1 && url.pathname.charCodeAt(end - 1) === 47) end--;
    return {page: `${url.protocol}//${url.host}${url.pathname.slice(0, end)}`, query: url.search};
  } catch {
    return null;
  }
}

class OpenGraphCanonicalMatch extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'open-graph-canonical-match',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['MetaElements', 'LinkElements'],
    };
  }

  /**
   * @param {{
   *   MetaElements: Array<{content?: string, property?: string}>,
   *   LinkElements: Array<{rel: string, href: string | null, source: string}>,
   * }} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const ogUrl = artifacts.MetaElements.find(
      meta => meta.property === 'og:url' && meta.content
    )?.content;
    const canonicalHref = artifacts.LinkElements.find(
      link => link.rel === 'canonical' && link.source !== 'body' && link.href
    )?.href;

    if (!ogUrl || !canonicalHref) {
      return {score: 1, notApplicable: true};
    }

    const normalizedOgUrl = normalize(ogUrl);
    const normalizedCanonical = normalize(canonicalHref);

    // An unparseable URL on either side is that other property's own validity concern, not this
    // comparison's — nothing meaningful to compare, so this audit stays silent rather than
    // guessing at a mismatch.
    if (!normalizedOgUrl || !normalizedCanonical) {
      return {score: 1, notApplicable: true};
    }

    if (normalizedOgUrl.page === normalizedCanonical.page) {
      // Only the query string differs (often a tracking parameter): a note, not a mismatch.
      return normalizedOgUrl.query === normalizedCanonical.query
        ? {score: 1}
        : {score: 1, displayValue: 'Differs only by the query string (a note)'};
    }

    return {
      score: 0,
      explanation: `og:url ("${ogUrl}") does not match the canonical URL ("${canonicalHref}").`,
    };
  }
}

export default OpenGraphCanonicalMatch;
export {UIStrings};
