/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {sameAsValuesProduct} from '../lib/entity.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'sameAs addresses are well formed',
  failureTitle: 'sameAs addresses need attention',
  description:
    "Advice, not a failure (a partial score). For each organization, business or person in the page's JSON-LD, checks its " +
    "sameAs list (the profile pages on other sites that Google's organization guidance recommends): each must be a full " +
    'http(s) address on a public host. A missing scheme (facebook.com/acme), a mailto: or javascript: address or a non-public ' +
    'host is a problem; http instead of https, a duplicate, the page itself, an address on the same site, and a list of more than ' +
    '15 are notes. A page with no sameAs list is not applicable.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class EntitySameAsValues extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'entity-same-as-values',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/entity.js`, unit-tested there.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact, URL: {finalDisplayedUrl?: string, requestedUrl?: string}}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const pageUrl =
      (artifacts.URL && (artifacts.URL.finalDisplayedUrl || artifacts.URL.requestedUrl)) || '';
    return sameAsValuesProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd), pageUrl);
  }
}

export default EntitySameAsValues;
export {UIStrings};
