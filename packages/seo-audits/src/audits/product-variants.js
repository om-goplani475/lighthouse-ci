/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {variantsProduct} from '../lib/ecommerce.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Product variants are marked up correctly',
  failureTitle: 'Product variants need attention',
  description:
    "Advice, not a failure (a partial score). Google's product variants guidance: a ProductGroup needs a productGroupID, " +
    'variesBy (size, color, material, pattern, suggestedAge or suggestedGender) and its variants in hasVariant; each variant ' +
    'needs its own sku or gtin and no two may share one. Products on the page that share a name but have different ' +
    'identifiers and are not in a group look like variants that were not grouped. A page with no Product markup is not ' +
    'applicable.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ProductVariants extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'product-variants',
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
    return variantsProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd));
  }
}

export default ProductVariants;
export {UIStrings};
