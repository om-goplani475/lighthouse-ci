/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure parsing/interpretation helpers for a fetched robots.txt, shared by the `robots-txt-*`
 * audits. The raw file comes from Lighthouse core's own `RobotsTxt` artifact ({status, content}) —
 * no new gatherer or outbound fetch is needed for it.
 *
 * Follows Google's documented robots.txt handling: directive names are case-insensitive, `#`
 * starts a comment, and `Sitemap` is a group-independent directive that must be a full URL.
 */

/**
 * @typedef {{status: number | null, content: string | null, errorMessage?: string}} RobotsTxtArtifact
 * @typedef {{type: 'allow' | 'disallow', path: string, line: number}} RobotsRule
 * @typedef {{agents: string[], rules: RobotsRule[]}} RobotsGroup
 */

/**
 * @param {string} content
 * @return {{groups: RobotsGroup[], sitemaps: string[]}}
 */
function parseRobotsTxt(content) {
  /** @type {RobotsGroup[]} */
  const groups = [];
  /** @type {string[]} */
  const sitemaps = [];
  /** @type {RobotsGroup | null} */
  let current = null;
  // A run of consecutive User-agent lines shares one group; a rule line closes that run.
  let collectingAgents = false;

  content.split(/\r\n|\r|\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon === -1) return;
    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (directive === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (directive === 'user-agent') {
      if (!current || !collectingAgents) {
        current = {agents: [], rules: []};
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (directive === 'allow' || directive === 'disallow') {
      collectingAgents = false;
      // Rules before any User-agent line belong to no group; ignore them, as crawlers do.
      if (current) current.rules.push({type: directive, path: value, line: index + 1});
    }
  });

  return {groups, sitemaps};
}

/**
 * Whether robots.txt was retrieved as an actual file. A 4xx means "no robots.txt" (crawlers treat
 * that as no restrictions); 5xx or a network failure means the state is unknown right now.
 * @param {RobotsTxtArtifact} robotsTxt
 * @return {'present' | 'absent' | 'unavailable'}
 */
function robotsTxtState(robotsTxt) {
  const {status, content} = robotsTxt;
  if (status === null || status === undefined || status >= 500) return 'unavailable';
  if (status >= 200 && status < 300 && content !== null) return 'present';
  return 'absent';
}

export {parseRobotsTxt, robotsTxtState};
