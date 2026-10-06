/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildReportResult} from '../lib/robots-directives.js';
import {resolveRobotsSources} from '../lib/robots-sources.js';

const UIStrings = {
  title: 'Robots directives are reported',
  description:
    'Lists every robots directive found in the page\'s <meta name="robots"> tag and/or ' +
    '`X-Robots-Tag` HTTP response header, each with a plain-English explanation of what it ' +
    "actually does. Purely informational — having directives here isn't inherently good or " +
    "bad (a deliberately noindexed staging page is fine); it's a report, not a pass/fail check. " +
    'An unrecognized token (e.g. a typo) is still listed, flagged as unrecognized, since a typo ' +
    'silently doing nothing is exactly the kind of mistake worth surfacing.',
};

class RobotsDirectivesReport extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'robots-directives-report',
      title: UIStrings.title,
      description: UIStrings.description,
      supportedModes: ['navigation'],
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['MetaElements', 'DevtoolsLog', 'URL'],
    };
  }

  /**
   * Deliberately thin: all decision logic lives in `buildReportResult`
   * (`lib/robots-directives.js`), unit-tested directly there. This method's only job — resolving
   * `MetaElements`/the `X-Robots-Tag` header via Lighthouse's `MainResource` computed artifact —
   * is verified by the live `lhci collect` run instead (see docs/qa/robots-directives.md), since
   * faking `MainResource`'s real network-record parsing isn't worth it for what's ultimately a
   * thin artifact-resolution step.
   * @param {{MetaElements: Array<{name?: string, content?: string}>, DevtoolsLog: unknown, URL: unknown}} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const sources = await resolveRobotsSources(artifacts.MetaElements, artifacts, context);
    return buildReportResult(sources);
  }
}

export default RobotsDirectivesReport;
export {UIStrings};
