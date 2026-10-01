/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {conflictsProduct} from '../lib/indexability.js';
import {resolveIndexabilityInput} from '../lib/indexability-sources.js';

const UIStrings = {
  title: "The page's indexing signals agree with each other",
  failureTitle: "The page's indexing signals contradict each other",
  description:
    'Fails when the signals for this page disagree, which is never intentional: noindex that ' +
    'robots.txt stops Googlebot or Bingbot from ever reading, noindex together with a canonical to ' +
    'another URL, a canonical that robots.txt stops a crawler reading, a canonical on an error page, ' +
    'and a canonical whose target (requested once, same site only) redirects, errors, is noindex, ' +
    'is blocked by robots.txt or declares yet another canonical. A meta-versus-header disagreement is ' +
    'robots-directives-conflict and a noindex page listed in a sitemap is sitemap-indexability, so ' +
    'neither is repeated here. It does not see a noindex or canonical added by JavaScript after load.',
};

class IndexabilityConflicts extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'indexability-conflicts',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - IndexabilitySignals isn't part of Lighthouse's own closed Artifacts type from
      // an out-of-tree package — same boundary already documented in the other audits in this package.
      requiredArtifacts: ['RobotsTxt', 'MetaElements', 'IndexabilitySignals', 'DevtoolsLog', 'URL'],
    };
  }

  /**
   * Thin on purpose: the decisions and the table are in `lib/indexability.js`, unit-tested there.
   * @param {any} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    return conflictsProduct(await resolveIndexabilityInput(artifacts, context));
  }
}

export default IndexabilityConflicts;
export {UIStrings};
