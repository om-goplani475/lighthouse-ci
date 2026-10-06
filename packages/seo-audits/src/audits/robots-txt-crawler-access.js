/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {NetworkRecords} from 'lighthouse/core/computed/network-records.js';
import {robotsTxtState} from '../lib/robots-txt.js';
import {simulateCrawlerAccess, buildAccessResult} from '../lib/robots-access.js';

const UIStrings = {
  title: 'robots.txt lets search engines crawl this page and its CSS/JS',
  failureTitle: 'robots.txt blocks a search engine from this page or its CSS/JS',
  description:
    "Simulates robots.txt for Googlebot and Bingbot against this page and the page's same-origin " +
    'CSS and JS (blocking those stops a search engine rendering the page like a visitor sees it). ' +
    'The table also shows Googlebot-Image and AI crawlers (GPTBot, ClaudeBot, CCBot, ' +
    "PerplexityBot) for reference only — blocking AI crawlers is a legitimate choice, so they're " +
    'never scored. Only files on the same origin as robots.txt are checked. Not-applicable when ' +
    'robots.txt could not be retrieved; a missing robots.txt (404) allows everything.',
};

class RobotsTxtCrawlerAccess extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'robots-txt-crawler-access',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      supportedModes: ['navigation'],
      requiredArtifacts: ['RobotsTxt', 'URL', 'DevtoolsLog'],
    };
  }

  /**
   * Deliberately thin — matching logic lives in `lib/robots-access.js`, unit-tested directly.
   * Resolving `NetworkRecords` is verified by the live `lhci collect` run, same as the
   * robots-directives audits' `MainResource` step.
   * @param {{RobotsTxt: import('../lib/robots-txt.js').RobotsTxtArtifact, URL: {finalDisplayedUrl: string}, DevtoolsLog: unknown}} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const state = robotsTxtState(artifacts.RobotsTxt);
    if (state === 'unavailable') {
      return {score: null, notApplicable: true};
    }
    if (state === 'absent') {
      return {score: 1};
    }

    // @ts-expect-error - DevtoolsLog is typed `unknown` here to keep this file loadable outside
    // Lighthouse's closed Artifacts type; the computed artifact validates it at runtime.
    const records = await NetworkRecords.request(artifacts.DevtoolsLog, context);
    const resources = records.map(r => ({url: r.url, type: String(r.resourceType)}));

    return buildAccessResult(
      simulateCrawlerAccess(artifacts.RobotsTxt, artifacts.URL.finalDisplayedUrl, resources)
    );
  }
}

export default RobotsTxtCrawlerAccess;
export {UIStrings};
