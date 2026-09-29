/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

const UIStrings = {
  title: 'Document title avoids common quality issues',
  failureTitle: 'Document title has a quality issue',
  description:
    'Beyond simply having a title (already checked by Lighthouse core), a good title is unique, ' +
    'descriptive, and not left over from a template default. Checks for generic/placeholder ' +
    'text, titles too short to be meaningful, and multiple conflicting <title> elements. Missing ' +
    "or empty titles are not this audit's concern — see the core `document-title` audit.",
};

// Common template/CMS default titles left un-edited — normalized (trimmed, lowercased, collapsed
// whitespace) before matching. Not exhaustive; a fixed, hand-curated list rather than a pattern
// match, so it only flags exact well-known defaults, never a real (if short) title that happens
// to share a word with one of these.
const GENERIC_TITLES = new Set([
  'untitled',
  'untitled document',
  'untitled page',
  'new page',
  'document',
  'home',
  'index',
  'default',
  'welcome',
  'my website',
  'website',
  'test',
  'test page',
  'page 1',
]);

// Below this length (after trimming), a title is unlikely to meaningfully describe a page.
// Arbitrary but conservative — deliberately short enough that this rarely fires on a real,
// intentional short title (e.g. a brand name alone), only on near-empty ones a template or CMS
// left behind ("Home", "New", "..."). Chosen independently of GENERIC_TITLES so a short title
// not on that list (e.g. "Blog") still gets flagged once, not zero times.
const MIN_MEANINGFUL_LENGTH = 10;

/**
 * @param {string} text
 * @return {string}
 */
function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// @ts-expect-error - PixelWidth isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class DocumentTitleQuality extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'document-title-quality',
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
    const {title, titleElementCount} = artifacts.PixelWidth;

    /** @type {Array<{issue: string, detail: string}>} */
    const rows = [];

    // Checked independently of whether `title` itself is present/empty — a page can have zero
    // meaningful title text and still have two (empty) <title> elements, which is its own
    // structural problem regardless of what document.title happens to resolve to.
    if (titleElementCount > 1) {
      rows.push({
        issue: 'Multiple <title> elements',
        detail:
          `Found ${titleElementCount} <title> elements. Only the first is used by browsers ` +
          'and most crawlers; behavior for the rest is undefined and inconsistent.',
      });
    }

    if (title) {
      const normalized = normalize(title.text);

      if (GENERIC_TITLES.has(normalized)) {
        rows.push({
          issue: 'Generic/placeholder title',
          detail:
            `"${title.text}" looks like an unedited template or CMS default, not a ` +
            'real page title.',
        });
      }

      if (normalized.length < MIN_MEANINGFUL_LENGTH) {
        rows.push({
          issue: 'Title too short',
          detail:
            `"${title.text}" is only ${normalized.length} characters — likely too short to ` +
            'meaningfully describe the page to searchers.',
        });
      }
    }

    if (rows.length === 0) {
      // Missing/empty title (and zero or one <title> elements) is core's document-title audit's
      // concern, not this one's — see the feature's scope boundary.
      if (!title && titleElementCount <= 1) {
        return {score: null, notApplicable: true};
      }
      return {score: 1};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'issue', valueType: 'text', label: 'Issue'},
      {key: 'detail', valueType: 'text', label: 'Detail'},
    ];

    return {
      score: 0,
      details: Audit.makeTableDetails(headings, rows),
    };
  }
}

export default DocumentTitleQuality;
export {UIStrings, GENERIC_TITLES, MIN_MEANINGFUL_LENGTH};
