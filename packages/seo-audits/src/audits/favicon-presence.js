/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {faviconLinks} from '../lib/favicon.js';

const UIStrings = {
  title: 'Favicon link',
  failureTitle: 'Page does not declare a favicon',
  description:
    'Informational (never fails a build). A favicon (`<link rel="icon">`) helps users identify your site among browser tabs and ' +
    'bookmarks. This audit only checks for an explicit favicon `<link>` — most browsers fall ' +
    'back to requesting `/favicon.ico` from the site root when none is declared, which this ' +
    'audit does not verify actually exists (that would require a network fetch this check ' +
    'deliberately avoids; see docs/phases/phase-1-page-metadata.md\'s "To do later" section).',
};

// @ts-expect-error - FaviconLinks isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class FaviconPresence extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'favicon-presence',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['FaviconLinks'],
    };
  }

  /**
   * @param {{FaviconLinks: import('../gatherers/favicon-links.js').FaviconLinksArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const hasFavicon = faviconLinks(artifacts.FaviconLinks).length > 0;
    return hasFavicon
      ? {score: 1}
      : {
          score: 0,
          displayValue: 'No favicon link (browsers try /favicon.ico)',
          explanation: 'No <link rel="icon"> or <link rel="shortcut icon"> element was found.',
        };
  }
}

export default FaviconPresence;
export {UIStrings};
