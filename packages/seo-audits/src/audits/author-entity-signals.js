/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildEntitySignalsProduct} from '../lib/ai-entities.js';

const UIStrings = {
  title: 'Who wrote and who publishes the page',
  description:
    'Informational and descriptive only: the author and publisher the page declares (JSON-LD, meta author, rel author), its sameAs links and whether they are absolute http or https URLs, whether an Organization logo is declared, and whether the site name is the same in JSON-LD and og:site_name. It never fails and says nothing about how an answer engine uses these signals.',
};

class AuthorEntitySignals extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'author-entity-signals',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['StructuredDataJsonLd', 'MetaElements', 'LinkElements'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ai-entities.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildEntitySignalsProduct(
      artifacts.StructuredDataJsonLd,
      artifacts.MetaElements,
      artifacts.LinkElements
    );
  }
}

export default AuthorEntitySignals;
export {UIStrings};
