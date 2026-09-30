/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Checks Twitter/X Card meta tag completeness. `twitter:card` is the only tag genuinely required
 * on its own — `twitter:title`/`twitter:description`/`twitter:image` fall back to their
 * `og:title`/`og:description`/`og:image` equivalents when the `twitter:`-specific tag is absent,
 * so those three are checked as "required, with an Open Graph fallback" rather than required
 * outright. `twitter:site`/`twitter:creator` are recommended (attribution), and `twitter:image:alt`
 * is recommended when an image is present (accessibility), same shape as
 * open-graph-completeness.js's `og:image:alt` check.
 *
 * Sourcing caveat, stated plainly: X's official developer documentation for Cards markup is
 * largely paywalled/degraded since the platform's ownership change and could not be directly
 * verified the way schema.org's pages were for the deprecated-properties audit. What's checked
 * here is corroborated across multiple secondary sources, not a single fetched authoritative page
 * — see `docs/phases/phase-3-social-metadata.md`'s sourcing note.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {twitterContent, twitterResolved} from '../lib/social-meta.js';

const UIStrings = {
  title: 'Twitter/X Card metadata is complete',
  failureTitle: 'Twitter/X Card metadata is missing required properties',
  description:
    '`twitter:card` is required. `twitter:title`/`twitter:description`/`twitter:image` fall ' +
    'back to their Open Graph equivalents when absent, so they only fail here if neither the ' +
    '`twitter:`-specific tag nor its `og:*` fallback is present. `twitter:site`/`twitter:creator` ' +
    'and `twitter:image:alt` (when an image is present) are recommended and reported ' +
    'informationally, never failing the audit on their own.',
};

class TwitterCardCompleteness extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'twitter-card-completeness',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['MetaElements'],
    };
  }

  /**
   * @param {{MetaElements: Array<{name?: string, content?: string, property?: string}>}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {MetaElements} = artifacts;
    const cardType = twitterContent(MetaElements, 'twitter:card');

    if (!cardType) {
      // Nothing else is meaningful to check without a card type — a page with zero twitter:*
      // tags and zero intent to declare a card isn't a partial-completeness case, it's simply
      // not using Twitter Cards at all. Still scored (not not-applicable): declaring intent via
      // og:title/og:image but skipping the one Twitter-specific tag needed to render a card is a
      // real, fixable gap, not a legitimate opt-out this audit should stay silent about.
      return {
        score: 0,
        explanation: 'Missing required "twitter:card" meta tag.',
      };
    }

    /** @type {Array<{property: string, severity: 'error' | 'info', message: string}>} */
    const rows = [];

    /** @type {Array<'title' | 'description' | 'image'>} */
    const fallbackFields = ['title', 'description', 'image'];
    for (const field of fallbackFields) {
      if (!twitterResolved(MetaElements, field)) {
        rows.push({
          property: `twitter:${field}`,
          severity: 'error',
          message:
            `Missing "twitter:${field}", and no "og:${field}" fallback is present ` + 'either.',
        });
      }
    }

    for (const property of ['twitter:site', 'twitter:creator']) {
      if (!twitterContent(MetaElements, property)) {
        rows.push({
          property,
          severity: 'info',
          message: `Recommended "${property}" meta tag is not present.`,
        });
      }
    }

    const hasImage = twitterResolved(MetaElements, 'image');
    if (hasImage && !twitterContent(MetaElements, 'twitter:image:alt')) {
      rows.push({
        property: 'twitter:image:alt',
        severity: 'info',
        message: 'Recommended "twitter:image:alt" is not present, for accessibility.',
      });
    }

    const hasErrors = rows.some(row => row.severity === 'error');

    if (rows.length === 0) {
      return {score: 1};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'property', valueType: 'text', label: 'Property'},
      {key: 'severity', valueType: 'text', label: 'Severity'},
      {key: 'message', valueType: 'text', label: 'Message'},
    ];

    return {
      score: Number(!hasErrors),
      details: Audit.makeTableDetails(headings, rows),
    };
  }
}

export default TwitterCardCompleteness;
export {UIStrings};
