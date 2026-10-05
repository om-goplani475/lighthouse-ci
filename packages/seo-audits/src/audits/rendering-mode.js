/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildRenderingModeProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'How the page is rendered',
  failureTitle: 'How the page is rendered',
  description:
    'Informational: classifies the page as server-rendered (90% or more of the text is in the HTML), client-rendered (under 20%) or hybrid, with the framework signs found in the HTML (Next.js, Nuxt, Angular, an empty root element and similar). A heuristic from word counts, not a guarantee.',
};

class RenderingMode extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'rendering-mode',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['MainDocumentContent', 'RenderedHtml', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/rendering.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildRenderingModeProduct(
      artifacts.MainDocumentContent,
      artifacts.RenderedHtml,
      artifacts.URL.finalDisplayedUrl
    );
  }
}

export default RenderingMode;
export {UIStrings};
