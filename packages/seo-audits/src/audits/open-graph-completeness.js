/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Checks Open Graph (`og:*`) meta tag completeness against the actual protocol spec (ogp.me),
 * not a guessed or industry-blog list: four properties are genuinely required
 * (`og:title`/`og:type`/`og:image`/`og:url`), three are recommended but not required
 * (`og:description`/`og:site_name`/`og:image:alt`, the last only when an `og:image` is present at
 * all). Deliberately does not check `og:image` pixel dimensions/aspect ratio — the spec states no
 * minimum or recommended dimensions, so any numeric threshold here would be an invented, unverified
 * number rather than a real one; see `docs/phases/phase-3-social-metadata.md`'s "To do later" for
 * why that's deferred rather than guessed at. No new gatherer needed — Lighthouse core's own
 * `MetaElements` artifact already captures each meta tag's `property` attribute, which is what
 * `og:*` tags use (as opposed to `name`, which `robots-directives-report.js` reads from the same
 * artifact for `<meta name="robots">`).
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'Open Graph metadata has a title and an image',
  failureTitle: 'Open Graph metadata is missing a title or an image',
  description:
    'Open Graph tags control how a page appears when shared on social platforms and in chat/' +
    'messaging link previews. Fails only when `og:title` or `og:image` is missing, the two a good ' +
    'preview needs. `og:type` and `og:url` (the protocol lists them as required, but platforms default ' +
    'og:type to website and fall back to the page URL), `og:description`, `og:site_name` and ' +
    '`og:image:alt` (when an image is present) are reported as recommendations and never fail the audit.',
};

// Only what a link preview needs. Platforms default og:type to "website" and fall back to the page URL when
// og:url is absent, so those two are recommended, not required.
const REQUIRED_PROPERTIES = ['og:title', 'og:image'];
const RECOMMENDED_PROPERTIES = ['og:type', 'og:url', 'og:description', 'og:site_name'];

/**
 * @param {Array<{name?: string, content?: string, property?: string}>} metaElements
 * @param {string} property
 * @return {string[]} non-empty, trimmed content values, in document order
 */
function contentValuesFor(metaElements, property) {
  return metaElements
    .filter(meta => meta.property === property || meta.name === property)
    .map(meta => (meta.content || '').trim())
    .filter(Boolean);
}

class OpenGraphCompleteness extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'open-graph-completeness',
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
    /** @type {Array<{property: string, severity: 'error' | 'info', message: string}>} */
    const rows = [];

    for (const property of REQUIRED_PROPERTIES) {
      if (contentValuesFor(artifacts.MetaElements, property).length === 0) {
        rows.push({
          property,
          severity: 'error',
          message: `Missing required "${property}" meta tag.`,
        });
      }
    }

    for (const property of RECOMMENDED_PROPERTIES) {
      if (contentValuesFor(artifacts.MetaElements, property).length === 0) {
        rows.push({
          property,
          severity: 'info',
          message: `Recommended "${property}" meta tag is not present.`,
        });
      }
    }

    const hasImage = contentValuesFor(artifacts.MetaElements, 'og:image').length > 0;
    if (hasImage && contentValuesFor(artifacts.MetaElements, 'og:image:alt').length === 0) {
      rows.push({
        property: 'og:image:alt',
        severity: 'info',
        message:
          'Recommended "og:image:alt" is not present — the Open Graph protocol recommends it ' +
          'whenever og:image is set, for accessibility.',
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

export default OpenGraphCompleteness;
export {UIStrings, REQUIRED_PROPERTIES, RECOMMENDED_PROPERTIES};
