/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildHiddenTextProduct} from '../lib/content-hidden.js';

const UIStrings = {
  title: 'Text hidden by styling tricks',
  description:
    'Informational: counts words that are on the page but made invisible by a styling trick (a font of 2 px or less, pushed off the screen, the same colour as the background, fully transparent). Search engines treat a lot of such text as a spam sign. Text hidden with display none, in an accordion or details element, or for screen readers only is ordinary and is not counted. A heuristic; never fails.',
};

class HiddenText extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hidden-text',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['PageContent'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/content-hidden.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildHiddenTextProduct(artifacts.PageContent);
  }
}

export default HiddenText;
export {UIStrings};
