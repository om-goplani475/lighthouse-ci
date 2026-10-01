/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {soft404Product} from '../lib/soft-404.js';

const UIStrings = {
  title: 'The site returns 404 for URLs that do not exist',
  failureTitle: 'The site answers URLs that do not exist as normal pages (soft 404)',
  description:
    'Requests two made-up URLs on this origin (a top-level path and a nested `.html` path) and ' +
    'checks that the site answers 404 or 410. It fails when a made-up URL returns a normal page ' +
    '(HTTP 2xx), or redirects to a same-origin page that does (the "unknown URLs bounce to the ' +
    'homepage" pattern Google reports as a soft 404): a catch-all route or a single-page app ' +
    'answering every path lets search engines index endless junk URLs. A redirect to another ' +
    'origin is not followed and not judged; a server error is shown but does not fail. This sends ' +
    'up to four status-only requests to your site, which will show as 404s in its logs. It does not ' +
    'look at the wording of real pages ("not found" text on a 200 page), which needs the crawler.',
};

// @ts-expect-error - Soft404Probe isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class Soft404 extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'soft-not-found',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['Soft404Probe'],
    };
  }

  /**
   * Thin on purpose: the decisions and the table are in `lib/soft-404.js`, unit-tested there.
   * @param {{Soft404Probe: import('../lib/soft-404.js').Soft404Artifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return soft404Product(artifacts.Soft404Probe);
  }
}

export default Soft404;
export {UIStrings};
