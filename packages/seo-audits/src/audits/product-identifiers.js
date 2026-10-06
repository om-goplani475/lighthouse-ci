/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {identifiersProduct} from '../lib/ecommerce.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Products carry valid identifiers',
  failureTitle: 'Product identifiers are missing or invalid',
  description:
    "Advice, not a failure (a partial score). For each Product in the page's JSON-LD, checks that it has a gtin, mpn or " +
    'sku, that any GTIN is numeric, has a valid length and a valid check digit, that the sku has no whitespace, and that ' +
    "it names a brand: Google's merchant listing guidance. Products inside a ProductGroup are judged as products, the " +
    'group itself is not. A page with no Product markup is not applicable.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ProductIdentifiers extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'product-identifiers',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ecommerce.js`, unit-tested there.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return identifiersProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd));
  }
}

export default ProductIdentifiers;
export {UIStrings};
