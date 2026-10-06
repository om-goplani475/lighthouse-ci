/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {localValuesProduct} from '../lib/local.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Local business values are well formed',
  failureTitle: 'Local business values need attention',
  description:
    "Advice, not a failure (a partial score). Google's local business guidance: a phone number of 7 to 15 digits (a missing country code is a note), opening hours as weekday names and 24-hour times (or the compact Mo-Fr 09:00-17:00 form), geo coordinates in range and with at least 5 decimal places (0,0 is a placeholder), a priceRange under 100 characters, and a full PostalAddress (street, locality, country). Missing properties are reported by structured-data-schema-properties, not here. A page with no local business markup is not applicable.",
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class LocalBusinessValues extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'local-business-values',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/local.js`, unit-tested there.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return localValuesProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd));
  }
}

export default LocalBusinessValues;
export {UIStrings};
