/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildAiCrawlerProduct} from '../lib/ai-crawlers.js';

const UIStrings = {
  title: 'Which AI crawlers robots.txt allows on this page',
  description:
    'Informational: lists AI crawlers and AI-related robots.txt tokens (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot and others) and whether robots.txt allows each on this page, and whether its own rule or the wildcard decided it. Blocking an AI crawler is a legitimate choice, so this never fails. Vendors rename crawlers: the list is kept as data. Phase 4 robots-txt-crawler-access shows four of them inside a scored audit; this report extends the list.',
};

class AiCrawlerSummary extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'ai-crawler-summary',
      title: UIStrings.title,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['RobotsTxt', 'URL'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/ai-crawlers.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildAiCrawlerProduct(artifacts.RobotsTxt, artifacts.URL.finalDisplayedUrl);
  }
}

export default AiCrawlerSummary;
export {UIStrings};
