/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {parseRobotsTxt, robotsTxtState, findRuleConflicts} from '../lib/robots-txt.js';

const UIStrings = {
  title: 'robots.txt has no contradictory Allow/Disallow rules',
  failureTitle: 'robots.txt lists the same path as both Allow and Disallow',
  description:
    'When the same path is both allowed and disallowed for a crawler, the file says two opposite ' +
    'things. Google resolves it in favor of `Allow` (the least restrictive rule), so the ' +
    '`Disallow` silently does nothing — almost never what the author meant — and other crawlers ' +
    'may resolve it differently. Groups naming the same user-agent are merged before checking. ' +
    'An Allow and Disallow of *different* paths is ordinary precedence and is not flagged. ' +
    'Not-applicable when robots.txt could not be retrieved; a missing file has no rules to conflict.',
};

class RobotsTxtRuleConflicts extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'robots-txt-rule-conflicts',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['RobotsTxt'],
    };
  }

  /**
   * @param {{RobotsTxt: import('../lib/robots-txt.js').RobotsTxtArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const state = robotsTxtState(artifacts.RobotsTxt);
    if (state === 'unavailable') {
      return {score: null, notApplicable: true};
    }
    if (state === 'absent') {
      return {score: 1};
    }

    const {groups} = parseRobotsTxt(/** @type {string} */ (artifacts.RobotsTxt.content));
    const conflicts = findRuleConflicts(groups);
    if (conflicts.length === 0) {
      return {score: 1};
    }

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'agent', valueType: 'text', label: 'User-agent'},
      {key: 'path', valueType: 'code', label: 'Path'},
      {key: 'lines', valueType: 'text', label: 'Allow / Disallow line'},
    ];
    const items = conflicts.map(c => ({
      agent: c.agent,
      path: c.path,
      lines: `${c.allowLine} / ${c.disallowLine}`,
    }));

    return {
      score: 0,
      explanation: `${conflicts.length} path(s) are both allowed and disallowed for the same user-agent.`,
      details: Audit.makeTableDetails(headings, items),
    };
  }
}

export default RobotsTxtRuleConflicts;
export {UIStrings};
