/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The text the service posts: the sticky pull request comment (GitHub and GitLab markdown) and the Slack and Teams
 * alerts. Pure. Everything that came from the audited page (titles, explanations, URLs) is treated as hostile: it goes
 * through the table-cell escaper, and `@` is broken with a zero-width space so a page cannot make the comment notify a
 * user or a team. Slack control sequences (`<!channel>`, `<@U123>`, links) are neutralised for the same reason.
 */

import {cell} from '../summary/render.js';

const MAX_COMMENT_CHARS = 60_000;
const MAX_LIST = 10;
const ZERO_WIDTH_SPACE = '​';

/**
 * @param {unknown} text
 * @return {string} Markdown-safe single-line text that cannot ping anyone.
 */
function safe(text) {
  return cell(text).replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
}

/**
 * `encodeURIComponent` leaves parentheses alone, and a ")" would end a markdown link early.
 * @param {string} text
 * @param {RegExp} pattern The characters to encode.
 * @return {string}
 */
function percentEncode(text, pattern) {
  return text.replace(
    pattern,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

/**
 * @param {string} projectId
 * @return {string} The hidden marker that identifies this service's comment on a pull request.
 */
function markerFor(projectId) {
  return `<!-- lhci-seo-audit:${projectId} -->`;
}

/**
 * @param {number | null | undefined} n
 * @return {string}
 */
function score(n) {
  return typeof n === 'number' ? n.toFixed(1) : 'n/a';
}

/**
 * @param {number | null | undefined} d
 * @return {string}
 */
function change(d) {
  if (typeof d !== 'number') return 'n/a';
  if (d === 0) return 'no change';
  return d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
}

/**
 * @param {any} issue
 * @return {string}
 */
function issueLine(issue) {
  const level = issue.tier === 'error' ? 'Error' : 'Warning';
  const detail = issue.displayValue || issue.explanation;
  return `- **${level}:** ${safe(issue.title)} (\`${safe(issue.id).replace(/'/g, '')}\`)${
    detail ? `: ${safe(detail)}` : ''
  }`;
}

/**
 * @param {{
 *   projectId: string,
 *   run: {url: string, sha?: string | null, branch?: string | null, baseBranch?: string | null},
 *   result: any,
 *   reportUrl?: string | null,
 * }} input `result` is what the runner stored.
 * @return {string} The comment, always under 60,000 characters (GitHub's limit is 65,536).
 */
function renderPrComment({projectId, run, result, reportUrl}) {
  const summary = result && result.summary;
  const comparison = result && result.comparison;
  const out = [markerFor(projectId), ''];
  if (!summary || !summary.overall) {
    out.push('## SEO audit', '', 'The audit finished but produced no score.');
    return out.join('\n');
  }

  const delta = comparison ? ` (${change(comparison.overallDelta)})` : '';
  out.push(
    `## SEO audit: ${score(summary.overall.score)} (${safe(summary.overall.grade)})${delta}`,
    ''
  );
  const sha = run.sha
    ? `commit \`${String(run.sha)
        .slice(0, 7)
        .replace(/[^0-9a-f]/gi, '')
        .toLowerCase()}\``
    : '';
  out.push(`Page: ${safe(result.url || run.url)}${sha ? ` · ${sha}` : ''}`, '');
  if (!comparison) {
    out.push(`_${safe(result.baselineNote || 'No earlier run to compare with.')}_`, '');
  } else if (run.baseBranch) {
    out.push(
      `_Compared with the latest run on \`${safe(run.baseBranch).replace(/'/g, '')}\`._`,
      ''
    );
  }

  out.push('| Category | Score | Change |', '|---|---|---|');
  /** @type {any[]} */
  const categories = Array.isArray(summary.categories) ? summary.categories : [];
  const moved = new Map(
    (comparison && Array.isArray(comparison.categories) ? comparison.categories : []).map(
      (/** @type {any} */ c) => [c.name, c.delta]
    )
  );
  for (const c of categories) {
    if (c.applicable === 0) continue;
    out.push(
      `| ${safe(c.name)} | ${score(c.score)} (${safe(c.grade)}) | ${
        comparison ? change(moved.get(c.name)) : ''
      } |`
    );
  }
  out.push('');

  /** @type {any[]} */
  const issues = (Array.isArray(summary.audits) ? summary.audits : []).filter(
    (/** @type {any} */ a) => a.status === 'fail' || a.status === 'warn'
  );
  const lists = comparison
    ? [
        ['New issues', comparison.newIssues],
        ['Fixed', comparison.fixed],
        ['Still failing', comparison.stillFailing],
      ]
    : [['Issues', issues]];
  for (const [title, list] of /** @type {Array<[string, any[]]>} */ (lists)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    out.push(`### ${title} (${list.length})`, '');
    for (const item of list.slice(0, MAX_LIST)) out.push(issueLine(item));
    if (list.length > MAX_LIST) out.push(`- ...and ${list.length - MAX_LIST} more`);
    out.push('');
  }
  if (comparison && comparison.newIssues.length === 0 && comparison.fixed.length === 0) {
    out.push('No issues were added or fixed by this change.', '');
  }
  if (reportUrl) out.push(`[Full report](${percentEncode(reportUrl, /[()\s]/g)})`, '');
  if (result.blockedHosts && result.blockedHosts.length) {
    out.push(
      `_Chrome was blocked from reaching private addresses (${result.blockedHosts
        .map(safe)
        .join(', ')})._`,
      ''
    );
  }

  const text = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return text.length <= MAX_COMMENT_CHARS
    ? text
    : `${text.slice(0, MAX_COMMENT_CHARS - 40)}\n\n_(truncated)_`;
}

/**
 * @param {unknown} text
 * @return {string} Text for Slack's mrkdwn: control characters escaped, so a page cannot ping a channel or add a link.
 */
function slackSafe(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
}

/**
 * @param {{
 *   run: {url: string, repo?: string | null, sha?: string | null, branch?: string | null},
 *   regressions: Array<{id: string, title: string, detail?: string}>,
 *   reportUrl?: string | null,
 * }} input
 * @return {{title: string, lines: string[], link: string | null}} Plain parts; the sender formats them for Slack or Teams.
 */
function alertParts({run, regressions, reportUrl}) {
  const where = [run.repo, run.branch, run.sha ? String(run.sha).slice(0, 7) : null]
    .filter(Boolean)
    .join(' · ');
  return {
    title: `SEO regression on ${run.url}`,
    lines: [
      ...(where ? [where] : []),
      ...regressions
        .slice(0, MAX_LIST)
        .map(r => `${r.title} (${r.id})${r.detail ? `: ${r.detail}` : ''}`),
      ...(regressions.length > MAX_LIST ? [`...and ${regressions.length - MAX_LIST} more`] : []),
    ],
    link: reportUrl || null,
  };
}

/**
 * @param {ReturnType<typeof alertParts>} parts
 * @return {object} A Slack incoming-webhook body.
 */
function slackBody(parts) {
  const lines = parts.lines.map(l => `• ${slackSafe(l)}`);
  return {
    text: `:rotating_light: *${slackSafe(parts.title)}*\n${lines.join('\n')}${
      parts.link ? `\n<${percentEncode(parts.link, /[<>|\s]/g)}|Open the report>` : ''
    }`,
    link_names: 0,
    unfurl_links: false,
  };
}

/**
 * @param {ReturnType<typeof alertParts>} parts
 * @param {'adaptive' | 'messagecard'} format
 * @return {object} A Teams webhook body: an Adaptive Card message (Workflows) or a legacy MessageCard (connector).
 */
function teamsBody(parts, format) {
  const lines = parts.lines.map(l => `- ${safe(l)}`);
  if (format === 'messagecard') {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: slackSafe(parts.title),
      themeColor: 'D83B01',
      title: slackSafe(parts.title),
      text: lines.join('\n\n'),
      ...(parts.link && {
        potentialAction: [
          {
            '@type': 'OpenUri',
            name: 'Open the report',
            targets: [{os: 'default', uri: parts.link}],
          },
        ],
      }),
    };
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: slackSafe(parts.title),
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            },
            {type: 'TextBlock', text: lines.join('\n'), wrap: true},
          ],
          ...(parts.link && {
            actions: [{type: 'Action.OpenUrl', title: 'Open the report', url: parts.link}],
          }),
        },
      },
    ],
  };
}

export {
  renderPrComment,
  markerFor,
  alertParts,
  slackBody,
  teamsBody,
  safe,
  slackSafe,
  MAX_COMMENT_CHARS,
};
