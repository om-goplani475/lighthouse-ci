/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {loopProduct} from '../lib/url-variants.js';

const UIStrings = {
  title: 'No redirect loops',
  failureTitle: 'A redirect loop was found',
  description:
    'Follows each other form of the audited URL (see url-variant-consistency for what is probed) and fails when a redirect returns to a URL already visited, so a browser or crawler never reaches a page. Lighthouse itself aborts a run whose own page loops; this finds the loop on the variants before a visitor does.',
};

// @ts-expect-error - UrlVariants isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class RedirectLoop extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'redirect-loop',
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
    return loopProduct(artifacts.UrlVariants);
  }
}

export default RedirectLoop;
export {UIStrings};
