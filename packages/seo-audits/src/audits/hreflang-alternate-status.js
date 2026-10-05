/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildAlternateStatusProduct} from '../lib/hreflang-network.js';

const UIStrings = {
  title: 'Alternate versions answer normally',
  failureTitle: 'Some alternate versions are gone, redirect or are noindex',
  description:
    'Uses the same requests as hreflang-return-links and fails when an alternate answers 404 or 410, its host does not exist or refuses the connection, it redirects, or it is noindex. A 401, 403, 429, a server error, a timeout or a TLS error is a note, since bot protection and transient trouble are not defects of the page.',
};

class HreflangAlternateStatus extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hreflang-alternate-status',
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
    return buildAlternateStatusProduct(artifacts.HreflangData);
  }
}

export default HreflangAlternateStatus;
export {UIStrings};
