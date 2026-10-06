/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildConflictResult} from '../lib/robots-directives.js';
import {resolveRobotsSources} from '../lib/robots-sources.js';

const UIStrings = {
  title: 'Meta robots tag and X-Robots-Tag header agree on indexability',
  failureTitle: 'Meta robots tag and X-Robots-Tag header disagree on indexability',
  description:
    'Google honors the most restrictive of the two signals. Agreement is not required, but a ' +
    'mismatch is usually unintentional (e.g. a CDN or server config adding a blanket ' +
    "`X-Robots-Tag: noindex` that contradicts an intentionally-indexable page's meta tag, or " +
    'vice versa) rather than a deliberate choice — worth flagging as a real technical ' +
    'inconsistency, not an editorial content decision. Only checks the noindex/none ' +
    '(indexability) signal, not every directive — the other directives (nofollow, nosnippet, ' +
    'etc.) are reported but not scored by `robots-directives-report`.',
};

class RobotsDirectivesConflict extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'robots-directives-conflict',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      supportedModes: ['navigation'],
      requiredArtifacts: ['MetaElements', 'DevtoolsLog', 'URL'],
    };
  }

  /**
   * Deliberately thin — see robots-directives-report.js's equivalent method doc for why.
   * @param {{MetaElements: Array<{name?: string, content?: string}>, DevtoolsLog: unknown, URL: unknown}} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const sources = await resolveRobotsSources(artifacts.MetaElements, artifacts, context);
    return buildConflictResult(sources);
  }
}

export default RobotsDirectivesConflict;
export {UIStrings};
