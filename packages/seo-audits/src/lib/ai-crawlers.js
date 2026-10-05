/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `ai-crawler-summary` audit: which AI crawlers and AI-related
 * robots.txt tokens the site's robots.txt allows on the audited page. Blocking an AI crawler is a legitimate
 * choice, so this only reports and never fails. It reads the same `RobotsTxt` artifact as the Phase 4 crawler
 * audit and the same parsers, with a longer list. Vendor names change: the list is data to keep current. No I/O,
 * never throws.
 */

import robotsParser from 'robots-parser';
import {parseRobotsTxt, robotsTxtState} from './robots-txt.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{name: string, operator: string, purpose: string}} AiCrawler */

/** @type {AiCrawler[]} */
const AI_CRAWLERS = [
  {name: 'GPTBot', operator: 'OpenAI', purpose: 'model training'},
  {name: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search results'},
  {name: 'ChatGPT-User', operator: 'OpenAI', purpose: 'a user asked ChatGPT to open the page'},
  {name: 'ClaudeBot', operator: 'Anthropic', purpose: 'model training'},
  {name: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'search results'},
  {name: 'Claude-User', operator: 'Anthropic', purpose: 'a user asked Claude to open the page'},
  {name: 'PerplexityBot', operator: 'Perplexity', purpose: 'search index'},
  {
    name: 'Perplexity-User',
    operator: 'Perplexity',
    purpose: 'a user asked Perplexity to open the page',
  },
  {
    name: 'Google-Extended',
    operator: 'Google',
    purpose: 'a token that controls use for Gemini (not a crawler)',
  },
  {
    name: 'Applebot-Extended',
    operator: 'Apple',
    purpose: 'a token that controls use for Apple AI (not a crawler)',
  },
  {name: 'CCBot', operator: 'Common Crawl', purpose: 'a public web archive used to train models'},
  {name: 'Bytespider', operator: 'ByteDance', purpose: 'model training'},
  {name: 'Amazonbot', operator: 'Amazon', purpose: 'Alexa and AI features'},
  {name: 'Meta-ExternalAgent', operator: 'Meta', purpose: 'model training'},
  {name: 'DuckAssistBot', operator: 'DuckDuckGo', purpose: 'AI answers'},
];

const NOTE =
  'Blocking an AI crawler is a legitimate choice (some sites do, some want to be cited). Allowing a crawler does not guarantee it visits. Vendors rename their crawlers: check each vendor documentation for the current names.';

/**
 * @param {{status: number | null, content: string | null} | null | undefined} robotsTxt
 * @param {string} pageUrl
 * @return {Product}
 */
function buildAiCrawlerProduct(robotsTxt, pageUrl) {
  if (!robotsTxt || typeof robotsTxt !== 'object' || typeof pageUrl !== 'string') {
    return {score: 1, notApplicable: true, explanation: 'robots.txt was not collected.'};
  }
  const state = robotsTxtState(/** @type {any} */ (robotsTxt));
  if (state === 'unavailable') {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'robots.txt could not be retrieved, so access cannot be reported.',
    };
  }
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  let allowed = 0;
  if (state === 'absent') {
    for (const c of AI_CRAWLERS) {
      rows.push({
        crawler: c.name,
        operator: c.operator,
        purpose: c.purpose,
        page: 'Allowed',
        rule: 'no robots.txt',
      });
    }
    allowed = AI_CRAWLERS.length;
  } else {
    const content = /** @type {string} */ (robotsTxt.content);
    const robots = robotsParser(new URL('/robots.txt', pageUrl).href, content);
    const {groups} = parseRobotsTxt(content);
    for (const c of AI_CRAWLERS) {
      const ok = robots.isAllowed(pageUrl, c.name) !== false;
      const named = groups.some(g => g.agents.includes(c.name.toLowerCase()));
      if (ok) allowed++;
      rows.push({
        crawler: c.name,
        operator: c.operator,
        purpose: c.purpose,
        page: ok ? 'Allowed' : 'Blocked',
        rule: named ? 'its own rule' : 'the * rule',
      });
    }
  }
  rows.push({crawler: 'Note', operator: '', purpose: NOTE, page: '', rule: ''});
  const blocked = AI_CRAWLERS.length - allowed;
  return {
    score: 1,
    displayValue:
      blocked === 0
        ? `All ${AI_CRAWLERS.length} AI crawlers are allowed on this page`
        : `${allowed} of ${AI_CRAWLERS.length} AI crawlers are allowed on this page (${blocked} blocked)`,
    details: {
      type: 'table',
      headings: [
        {key: 'crawler', valueType: 'text', label: 'Crawler or token'},
        {key: 'operator', valueType: 'text', label: 'Operator'},
        {key: 'purpose', valueType: 'text', label: 'Used for'},
        {key: 'page', valueType: 'text', label: 'This page'},
        {key: 'rule', valueType: 'text', label: 'Decided by'},
      ],
      items: rows,
    },
  };
}

export {buildAiCrawlerProduct, AI_CRAWLERS};
