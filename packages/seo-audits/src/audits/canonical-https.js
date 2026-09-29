/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deliberately narrow: Lighthouse core's own `canonical` audit already checks presence, validity,
 * absoluteness, multiple-conflicting-URLs, hreflang mismatches, and the "points to domain root"
 * mistake (confirmed by reading its source before building this) — this audit only adds the one
 * thing core doesn't check: whether the canonical URL uses https. It does not re-fetch the
 * canonical URL to confirm it actually resolves (200, not redirected/404/blocked) or chase
 * canonical chains (A→B→A) — both would need a new outbound-fetch capability this package has
 * never had, with real SSRF-prevention obligations (see `.ai-agents/prompts/security-checklist.md`)
 * that are a meaningfully bigger step than this check. Recorded as a "to do later" item in
 * docs/phases/phase-1-page-metadata.md rather than built now.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'Canonical URL uses HTTPS',
  failureTitle: 'Canonical URL does not use HTTPS',
  description:
    'A canonical link pointing to an http:// URL undermines the point of serving the page over ' +
    'https — it tells search engines the "real" version of this page is the insecure one. ' +
    '(Presence, validity, and other canonical-URL problems are already checked by Lighthouse ' +
    "core's own `canonical` audit; this audit only covers the HTTPS scheme.)",
};

class CanonicalHttps extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'canonical-https',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['LinkElements'],
    };
  }

  /**
   * @param {{LinkElements: Array<{rel: string, href: string | null, source: string}>}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const canonicalHrefs = artifacts.LinkElements.filter(
      link => link.rel === 'canonical' && link.source !== 'body' && link.href
    ).map(link => /** @type {string} */ (link.href));

    if (canonicalHrefs.length === 0) {
      return {score: 1, notApplicable: true};
    }

    const nonHttpsHrefs = canonicalHrefs.filter(href => {
      try {
        return new URL(href).protocol !== 'https:';
      } catch {
        // An unparseable href is core's `canonical` audit's problem to flag, not this one's.
        return false;
      }
    });

    if (nonHttpsHrefs.length === 0) {
      return {score: 1};
    }

    return {
      score: 0,
      explanation: `The canonical URL does not use HTTPS: ${nonHttpsHrefs.join(', ')}`,
    };
  }
}

export default CanonicalHttps;
export {UIStrings};
