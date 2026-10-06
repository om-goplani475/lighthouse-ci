/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'Document has an <h1> element',
  failureTitle: 'Document has no <h1> element',
  description:
    'A present <h1> gives both search engines and assistive technology a clear ' +
    'top-level heading for the page. Zero <h1> elements leaves the page without one, which is ' +
    'reported as a warning (a partial score). More than one <h1> is allowed by HTML5 and Google ' +
    'says it is fine, so it is only shown as a note. (Heading level ' +
    "order and empty headings are already checked by Lighthouse core's `heading-order` and " +
    '`empty-heading` audits — this audit only covers H1 count.)',
};

// @ts-expect-error - Headings isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class DocumentH1Count extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'document-h1-count',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['Headings'],
    };
  }

  /**
   * @param {{Headings: import('../gatherers/headings.js').HeadingsArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {h1Texts} = artifacts.Headings;

    if (h1Texts.length === 1) {
      return {score: 1};
    }

    if (h1Texts.length === 0) {
      return {
        score: 0.5,
        displayValue: 'No <h1>',
        explanation: 'The page has no <h1> element (with non-empty text).',
      };
    }

    return {score: 1, displayValue: `${h1Texts.length} <h1> elements (allowed, a note)`};
  }
}

export default DocumentH1Count;
export {UIStrings};
