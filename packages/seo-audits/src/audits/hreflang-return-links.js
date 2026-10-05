/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildReturnLinksProduct} from '../lib/hreflang-network.js';

const UIStrings = {
  title: 'Alternate versions link back to this page',
  failureTitle: 'Some alternate versions do not link back to this page',
  description:
    'Requests up to 10 of the alternate versions (set LHCI_SEO_HREFLANG_MAX_CHECKS, 0 switches it off; the first 128 KiB, same-origin through the normal fetch, other hosts through the strict public-only fetch) and fails when an alternate has hreflang tags in its HTML but none names this page. An alternate with no hreflang tags in its HTML is a note (its tags may be in an HTTP header or only in the sitemap). Not applicable without hreflang or requests.',
};

class HreflangReturnLinks extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hreflang-return-links',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['HreflangData'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/hreflang-network.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildReturnLinksProduct(artifacts.HreflangData);
  }
}

export default HreflangReturnLinks;
export {UIStrings};
