/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildContentDatesProduct} from '../lib/content-dates.js';

const UIStrings = {
  title: 'The declared published and modified dates are consistent',
  failureTitle: 'The declared published and modified dates contradict each other',
  description:
    'Reads the published and modified dates the page declares (article:published_time-style meta tags and JSON-LD datePublished and dateModified) and fails only on a contradiction: a modified date before the published date, a date in the future, or two different published (or modified) dates. A day of tolerance covers time zones. The age of the page is shown for information. Not applicable when the page declares no date.',
};

class ContentDates extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'content-dates',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['PageContent', 'StructuredDataJsonLd', 'fetchTime'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/content-dates.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildContentDatesProduct(
      artifacts.PageContent,
      artifacts.StructuredDataJsonLd,
      artifacts.fetchTime
    );
  }
}

export default ContentDates;
export {UIStrings};
