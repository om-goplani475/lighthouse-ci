/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Confirms the sameAs profile addresses of the page's organization, business or person still exist. At most 8 addresses
 * (`LHCI_SEO_SAMEAS_MAX_CHECKS`, 0 switches it off, at most 20), one status request each (no body, no redirect followed, 5 s),
 * through the SSRF-protected helpers: addresses on other sites are requested with public addresses only. Only a 404, a 410 or a
 * host that does not exist is a defect: social networks routinely answer automated requests with 403, 429 or 999, which is only
 * a note, as elsewhere in this package.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {sameAsReachableProduct, parseMaxChecks} from '../lib/entity.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';
import {safeFetchStatus, safeFetchPublicStatus} from '../lib/safe-fetch.js';
import {siteOf} from '../lib/images.js';
import {THUMBNAIL_TIMEOUT_MS} from '../lib/video.js';

const UIStrings = {
  title: 'sameAs addresses are reachable',
  failureTitle: 'A sameAs address is gone',
  description:
    "Advice, not a failure (a partial score). Requests each sameAs address on another site in the page's JSON-LD (at most 8, " +
    'set by LHCI_SEO_SAMEAS_MAX_CHECKS, 0 switches it off; status only, no redirect followed, public addresses only) and warns ' +
    'for a 404, a 410 or a host that does not exist. A refusal (401, 403, 429, 999), a 5xx or a timeout is only a note: social ' +
    'networks refuse automated requests. Not applicable without a sameAs address on another site.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class EntitySameAsReachable extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'entity-same-as-reachable',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/entity.js`, unit-tested there with a fake fetcher; the real requests are verified by
   * the live `lhci collect` run.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact, URL: {finalDisplayedUrl?: string, requestedUrl?: string}}} artifacts
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static audit(artifacts) {
    const pageUrl =
      (artifacts.URL && (artifacts.URL.finalDisplayedUrl || artifacts.URL.requestedUrl)) || '';
    return sameAsReachableProduct(
      entitiesFromArtifact(artifacts.StructuredDataJsonLd),
      pageUrl,
      (url, firstParty) =>
        firstParty
          ? safeFetchStatus(url, {timeoutMs: THUMBNAIL_TIMEOUT_MS})
          : safeFetchPublicStatus(url, {timeoutMs: THUMBNAIL_TIMEOUT_MS}),
      siteOf,
      parseMaxChecks(process.env)
    );
  }
}

export default EntitySameAsReachable;
export {UIStrings};
