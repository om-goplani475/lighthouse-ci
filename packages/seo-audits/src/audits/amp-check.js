/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildAmpProduct} from '../lib/ai-amp.js';

const UIStrings = {
  title: 'AMP version of the page',
  description:
    'Informational: detects whether the page is an AMP page or links to an AMP version, and, for a linked version, requests it once (LHCI_SEO_AMP_CHECK=0 switches that off) to see whether it loads and names this page as its canonical. AMP is no longer required for Google Top Stories and is declining, so this only reports. Not applicable when the page has no AMP involvement.',
};

class AmpCheck extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'amp-check',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['AmpPage'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ai-amp.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildAmpProduct(artifacts.AmpPage);
  }
}

export default AmpCheck;
export {UIStrings};
