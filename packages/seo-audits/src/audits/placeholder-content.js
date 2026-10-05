/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildPlaceholderProduct} from '../lib/content-placeholder.js';

const UIStrings = {
  title: 'The page has no placeholder text',
  failureTitle: 'The page contains placeholder text',
  description:
    'Fails when the page text or title contains leftover filler: lorem ipsum, a template prompt such as "your text here", or a template tag that was never filled in ({{ name }}). Ordinary words such as coming soon or sample are not matched. A page that is itself about lorem ipsum or a template tool would be flagged. Reads the visible text of the main content in the browser.',
};

class PlaceholderContent extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'placeholder-content',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['PageContent'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/content-placeholder.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildPlaceholderProduct(artifacts.PageContent);
  }
}

export default PlaceholderContent;
export {UIStrings};
