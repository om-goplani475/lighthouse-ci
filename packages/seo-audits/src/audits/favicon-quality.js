/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {faviconLinks, isScalable, APPLE_TOUCH_RELS} from '../lib/favicon.js';

const UIStrings = {
  title: 'Favicon coverage is complete',
  failureTitle: 'Favicon coverage could be improved',
  description:
    'Purely informational suggestions, not requirements: a single small favicon works, but a ' +
    'scalable (SVG) icon or multiple declared sizes renders more sharply across browser tabs, ' +
    'bookmarks, and OS UI at different scales; an `apple-touch-icon` is what iOS uses when a ' +
    'user adds the page to their home screen, and falls back to a screenshot without one. ' +
    "Not-applicable if there's no favicon at all — see `favicon-presence` for that.",
};

// @ts-expect-error - FaviconLinks isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class FaviconQuality extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'favicon-quality',
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
    const icons = faviconLinks(artifacts.FaviconLinks);
    if (icons.length === 0) {
      return {score: null, notApplicable: true};
    }

    /** @type {Array<{aspect: string, detail: string}>} */
    const rows = [];

    const hasScalable = icons.some(isScalable);
    const distinctSizes = new Set(icons.map(icon => icon.sizes).filter(Boolean));
    if (!hasScalable && distinctSizes.size <= 1) {
      rows.push({
        aspect: 'Single size only',
        detail:
          'Only one favicon size is declared (or none at all) — consider adding a scalable ' +
          'SVG icon or multiple sizes for sharper rendering at different scales.',
      });
    }

    const hasAppleTouchIcon = artifacts.FaviconLinks.some(
      link => APPLE_TOUCH_RELS.has(link.rel) && link.href
    );
    if (!hasAppleTouchIcon) {
      rows.push({
        aspect: 'No apple-touch-icon',
        detail:
          'iOS uses a screenshot of the page instead of a proper icon when a user adds it to ' +
          'their home screen without one declared.',
      });
    }

    if (rows.length === 0) {
      // score: null, not 1 — this audit is scoreDisplayMode: informative, and every other
      // informational audit in this package uses null even for the "nothing to flag" case
      // (Lighthouse itself normalizes it to a displayed 1 in the LHR).
      return {score: null};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'aspect', valueType: 'text', label: 'Suggestion'},
      {key: 'detail', valueType: 'text', label: 'Detail'},
    ];

    return {
      score: null,
      details: Audit.makeTableDetails(headings, rows),
    };
  }
}

export default FaviconQuality;
export {UIStrings};
