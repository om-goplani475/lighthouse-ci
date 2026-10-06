/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {offerValuesProduct} from '../lib/ecommerce.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Product offer values are valid',
  failureTitle: 'Product offers have invalid values',
  description:
    'Fails when a value Google documents as invalid would make it ignore the offer: a price with a currency symbol, text, ' +
    'a thousands separator or a decimal comma (digits and a point only); a negative price; a priceCurrency that is not an ISO ' +
    '4217 code; an availability that is not a schema.org ItemAvailability value, or more than one; an itemCondition that is ' +
    'not NewCondition, RefurbishedCondition, UsedCondition or DamagedCondition, or more than one. `https://schema.org/InStock`, ' +
    '`schema:InStock` and a bare `InStock` are all accepted. A price of 0 and a lower-case currency are notes. Missing values are ' +
    'reported by structured-data-schema-properties, not here.',
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ProductOfferValues extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'product-offer-values',
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
    return offerValuesProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd));
  }
}

export default ProductOfferValues;
export {UIStrings};
