/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'Meta description is not just a copy of the page title',
  failureTitle: 'Meta description duplicates the page title',
  description:
    'A meta description that just repeats the page title wastes an opportunity: search ' +
    'engines show the title and description as two separate pieces of the result snippet, so a ' +
    'duplicate description gives searchers no new information to decide whether to click.',
};

/**
 * @param {string} text
 * @return {string}
 */
function normalize(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/, '');
}

/**
 * @param {string} title
 * @param {string} description
 * @return {'identical' | 'near-identical' | null}
 */
function classifyDuplication(title, description) {
  const normTitle = normalize(title);
  const normDescription = normalize(description);
  if (!normTitle || !normDescription) return null;

  if (normTitle === normDescription) return 'identical';

  // "Near-identical": one is fully contained in the other, and the shorter one accounts for at
  // least half of the longer one's length — catches e.g. a description that's just the title
  // plus a trailing site name ("My Page Title | My Site", a 0.5-0.6 ratio depending on the site
  // name's length), without flagging a description that merely opens with a few of the same
  // words before going on to say something substantively different (a real "Buy Running Shoes"
  // title followed by an unrelated, much longer sentence lands well under 0.5).
  const [shorter, longer] =
    normTitle.length <= normDescription.length
      ? [normTitle, normDescription]
      : [normDescription, normTitle];
  if (shorter.length === 0) return null;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.5) return 'near-identical';

  return null;
}

// @ts-expect-error - PixelWidth isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class MetaDescriptionIdenticalToTitle extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'meta-description-identical-to-title',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['PixelWidth'],
    };
  }

  /**
   * @param {{PixelWidth: import('../gatherers/pixel-width.js').PixelWidthArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {title, description} = artifacts.PixelWidth;

    if (!title || !description) {
      return {score: null, notApplicable: true};
    }

    const duplication = classifyDuplication(title.text, description.text);
    if (!duplication) {
      return {score: 1};
    }

    return {
      score: 0,
      explanation:
        duplication === 'identical'
          ? 'The meta description is identical to the page title.'
          : 'The meta description is nearly identical to the page title.',
    };
  }
}

export default MetaDescriptionIdenticalToTitle;
export {UIStrings, classifyDuplication};
