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
    'The Open Graph protocol defines `og:url` as the canonical URL of the page. When it ' +
    'disagrees with the page\'s own `<link rel="canonical">`, search and social crawlers are ' +
    'told two different "real" URLs for the same content.',
};

/**
 * @param {string} href
 * @return {string | null} normalized (protocol/host/path, trailing slash stripped, no hash) or
 *   null if unparseable
 */
function normalize(href) {
  try {
    const url = new URL(href);
    const path = url.pathname.replace(/\/$/, '') || '/';
    return `${url.protocol}//${url.host}${path}${url.search}`;
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

    if (normalizedOgUrl === normalizedCanonical) {
      return {score: 1};
    }

    return {
      score: 0,
      explanation: `og:url ("${ogUrl}") does not match the canonical URL ("${canonicalHref}").`,
    };
  }
}

export default OpenGraphCanonicalMatch;
export {UIStrings};
