/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Checks robots.txt declares at least one `Sitemap:` URL. Declaring it there is the one discovery
 * route every crawler (not just the ones you've registered in a search console) reads. It says
 * nothing about whether the sitemap itself is valid or reachable — that is a separate, later
 * Phase 4 item.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {parseRobotsTxt, robotsTxtState} from '../lib/robots-txt.js';

const UIStrings = {
  title: 'Sitemap declared in robots.txt',
  failureTitle: 'robots.txt does not declare a valid sitemap',
  description:
    'Informational (never fails a build). A `Sitemap:` line in robots.txt lets every crawler find your sitemap without a per-engine ' +
    'submission. It must be a full absolute URL. Submitting sitemaps through a search console ' +
    'also works, so treat this as a recommendation, not a requirement. Not-applicable when ' +
    'robots.txt could not be retrieved (a server error or network failure).',
};

class RobotsTxtSitemapDeclared extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'robots-txt-sitemap-declared',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
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
      return {
        score: 0,
        displayValue: 'No robots.txt',
        explanation: 'No robots.txt was found, so no sitemap is declared.',
      };
    }

    const {sitemaps} = parseRobotsTxt(/** @type {string} */ (artifacts.RobotsTxt.content));
    if (sitemaps.length === 0) {
      return {
        score: 0,
        displayValue: 'No Sitemap line',
        explanation: 'robots.txt has no `Sitemap:` line.',
      };
    }

    const invalid = sitemaps.filter(value => {
      try {
        const {protocol} = new URL(value);
        return protocol !== 'http:' && protocol !== 'https:';
      } catch {
        return true;
      }
    });
    if (invalid.length === sitemaps.length) {
      return {
        score: 0,
        displayValue: 'No valid Sitemap line',
        explanation: `No \`Sitemap:\` value is an absolute http(s) URL: ${invalid.join(', ')}`,
      };
    }

    return {score: 1};
  }
}

export default RobotsTxtSitemapDeclared;
export {UIStrings};
