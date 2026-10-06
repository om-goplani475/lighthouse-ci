/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDiffProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'Raw HTML compared with the rendered page',
  failureTitle: 'Raw HTML compared with the rendered page',
  description:
    'Informational: a side-by-side of the title, description, canonical, robots, first h1, word count and internal link count in the raw HTML and after JavaScript, with a note when the crawler own copy of the page differs from the one Chrome received (the server may answer bots differently).',
};

class RawRenderedDiff extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'raw-rendered-diff',
      title: UIStrings.title,
      description: UIStrings.description,
      supportedModes: ['navigation'],
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['MainDocumentContent', 'RenderedHtml', 'URL', 'SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/rendering.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildDiffProduct(
      artifacts.MainDocumentContent,
      artifacts.RenderedHtml,
      artifacts.URL.finalDisplayedUrl,
      artifacts.SiteCrawl
    );
  }
}

export default RawRenderedDiff;
export {UIStrings};
