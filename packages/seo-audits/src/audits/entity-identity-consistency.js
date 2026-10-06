/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {identityConsistencyProduct} from '../lib/entity.js';

const UIStrings = {
  title: 'An organization or person is described the same on every page',
  failureTitle: 'An organization or person is described inconsistently',
  description:
    'Advice, not a failure (a partial score). Compares how the crawled pages describe the same organization, business or person (the same @id, else the same url) and warns when the name, the logo or the profile address of one social network differs between pages (a name that differs only by legal form, case or accents is the same). A page that lists fewer profiles than another is not a conflict. As the other cross-page audits, the audited page is judged and the others are listed. Our judgement, not a Google requirement.',
};

// @ts-expect-error - SiteCrawl isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class EntityIdentityConsistency extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'entity-identity-consistency',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['SiteCrawl'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/entity.js`, unit-tested there.
   * @param {{SiteCrawl: import('../lib/crawl-snapshot.js').SiteCrawlArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return identityConsistencyProduct(artifacts.SiteCrawl);
  }
}

export default EntityIdentityConsistency;
export {UIStrings};
