/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {chainLengthProduct} from '../lib/url-variants.js';

const UIStrings = {
  title: 'Redirect chains are at most two hops',
  failureTitle: 'A redirect chain is longer than two hops',
  description:
    'Counts the redirects each other form of the audited URL (see url-variant-consistency for what is probed) takes to resolve. Warns (a partial score) when one takes more than 2, and fails only when one still redirects after 5: every extra hop slows the visitor and the redirect chain is where link signals and crawl budget leak. Covers the variants of this URL only, not the redirects of every link on the site (that needs the crawler).',
};

// @ts-expect-error - UrlVariants isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class RedirectChainLength extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'redirect-chain-length',
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
    return chainLengthProduct(artifacts.UrlVariants);
  }
}

export default RedirectChainLength;
export {UIStrings};
