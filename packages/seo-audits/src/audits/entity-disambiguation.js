/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {disambiguationProduct} from '../lib/entity.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Entity identity signals are reported',
  failureTitle: 'Entity identity signals are reported',
  description:
    "Informational (never fails a build). For each organization, business or person in the page's JSON-LD, shows which identity signals it carries: an @id, a url, a logo, how many sameAs profiles, and identifiers (iso6523Code, leiCode, duns, naics) that Google's organization guidance says help tell it apart from other organizations. None is required.",
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class EntityDisambiguation extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'entity-disambiguation',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/entity.js`, unit-tested there.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return disambiguationProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd));
  }
}

export default EntityDisambiguation;
export {UIStrings};
