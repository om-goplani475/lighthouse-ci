/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {verdictProduct} from '../lib/indexability.js';
import {resolveIndexabilityInput} from '../lib/indexability-sources.js';

const UIStrings = {
  title: 'Indexability verdict',
  description:
    'Walks the signals a search engine weighs for this page, in order (HTTP status, robots.txt, meta ' +
    'robots and X-Robots-Tag, canonical, text content) and says in plain English whether the page can ' +
    'be indexed and why. Informational: a deliberate noindex is legitimate, so this never fails. ' +
    'It does not see a noindex or canonical added by JavaScript after load, or a canonical sent only ' +
    'in an HTTP Link header. Contradictions between the signals are reported by ' +
    'indexability-conflicts. When the canonical points to another URL on the same site it makes one ' +
    'status request to that URL.',
};

class IndexabilityVerdict extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'indexability-verdict',
      title: UIStrings.title,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      description: UIStrings.description,
      supportedModes: ['navigation'],
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
    return verdictProduct(await resolveIndexabilityInput(artifacts, context));
  }
}

export default IndexabilityVerdict;
export {UIStrings};
