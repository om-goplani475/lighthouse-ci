/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {consistencyProduct} from '../lib/url-variants.js';

const UIStrings = {
  title: 'Every http/https/www form of the URL redirects to the audited one',
  failureTitle: 'Some http/https/www forms of the URL do not redirect to the audited one',
  description:
    "Probes the other forms of this page's URL (http:// of the same host, and the host with www " +
    "added or removed over http and https), using the audited page's own path and query, and " +
    "follows each one's redirects by hand (never to another site). Fails when another form serves " +
    'the page directly (the same content at two URLs), ends at a different origin, ends in an ' +
    'error, or drops the path or query. A temporary redirect (302/303/307) is shown as a note, ' +
    'and a form that does not exist is fine. It sends up to three status-only requests per hop, ' +
    'at most 5 hops each, through the SSRF-protected fetch; they show as extra requests in your ' +
    "site's logs. A www form is only probed for an apex or www host (not for app.example.com, " +
    'where wildcard DNS makes the name answer), and nothing is probed for an IP address, ' +
    'localhost, a non-default port or a page not served over HTTPS.',
};

// @ts-expect-error - UrlVariants isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class UrlVariantConsistency extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'url-variant-consistency',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['UrlVariants'],
    };
  }

  /**
   * Thin on purpose: the decisions and the table are in `lib/url-variants.js`, unit-tested there.
   * @param {{UrlVariants: import('../lib/url-variants.js').UrlVariantsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return consistencyProduct(artifacts.UrlVariants);
  }
}

export default UrlVariantConsistency;
export {UIStrings};
