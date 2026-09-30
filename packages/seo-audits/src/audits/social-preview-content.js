/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The "social preview renderer" item (Phase 3 item 5), scoped down after a design conversation:
 * an actual visual render of the link-card cannot be displayed inside a standard Lighthouse HTML
 * report — its `details.type: 'screenshot'` shape is hardcoded internal-only for the
 * `final-screenshot` audit's own special-cased UI (`node_modules/lighthouse/report/renderer/
 * details-renderer.js`'s `render()` explicitly returns `null` for it), and no other `details`
 * type can show a single composed image either. Building a real visual render would need editing
 * `packages/viewer`, which is exactly the boundary this fork's own rules say audit/gatherer work
 * shouldn't cross.
 *
 * What this reports instead: the exact text/URL content each platform would actually use for its
 * preview card, resolved through each platform's real fallback rules — not a picture of the card,
 * but the real content that determines what it says. Purely informational: this is a report of
 * what *would* show, not a pass/fail judgment (missing/invalid fields are
 * open-graph-completeness's/twitter-card-completeness's concern, not this audit's — this audit
 * runs regardless of whether those pass).
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {ogContent, twitterResolved} from '../lib/social-meta.js';

const UIStrings = {
  title: 'Social share preview content is reported',
  description:
    "Shows the exact title/description/image URL each platform's share preview card would " +
    "actually use, resolved through each platform's real fallback rules (Twitter/X falls back " +
    'to Open Graph tags when its own are absent; Facebook/LinkedIn and most other platforms ' +
    'read Open Graph tags directly). This is a content report, not a visual render — a true ' +
    "rendered image can't be shown inside a standard Lighthouse report (see this audit's module " +
    'doc) — and not a pass/fail check; missing or invalid fields are ' +
    "`open-graph-completeness`'s/`twitter-card-completeness`'s concern.",
};

class SocialPreviewContent extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'social-preview-content',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['MetaElements'],
    };
  }

  /**
   * @param {{MetaElements: Array<{name?: string, content?: string, property?: string}>}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {MetaElements} = artifacts;

    const facebook = {
      platform: 'Facebook / LinkedIn / most platforms (Open Graph)',
      title: ogContent(MetaElements, 'og:title') || '',
      description: ogContent(MetaElements, 'og:description') || '',
      image: ogContent(MetaElements, 'og:image') || '',
    };
    const twitter = {
      platform: 'Twitter / X',
      title: twitterResolved(MetaElements, 'title') || '',
      description: twitterResolved(MetaElements, 'description') || '',
      image: twitterResolved(MetaElements, 'image') || '',
    };

    const rows = [facebook, twitter];
    const hasAnyContent = rows.some(row => row.title || row.description || row.image);

    if (!hasAnyContent) {
      return {score: null, notApplicable: true};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'platform', valueType: 'text', label: 'Platform'},
      {key: 'title', valueType: 'text', label: 'Title'},
      {key: 'description', valueType: 'text', label: 'Description'},
      {key: 'image', valueType: 'url', label: 'Image'},
    ];

    return {
      score: null,
      details: Audit.makeTableDetails(headings, rows),
    };
  }
}

export default SocialPreviewContent;
export {UIStrings};
