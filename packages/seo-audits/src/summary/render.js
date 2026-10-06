/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Renders run summaries (and optional comparisons) as markdown or as plain data. Text that came from a page (an
 * audit's display value) is clipped and escaped for a markdown table cell: pipes, angle brackets, square brackets and
 * backticks cannot start a link, a code span or HTML. Pure: no I/O.
 */

/** @typedef {import('./run-summary.js').RunSummary} RunSummary */
/** @typedef {import('./run-summary.js').AuditResult} AuditResult */
/** @typedef {import('./compare.js').RunComparison} RunComparison */

const CELL_MAX = 140;

/**
 * @param {unknown} text
 * @return {string} Safe inside a markdown table cell.
 */
function cell(text) {
  const flat = String(text === undefined || text === null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim();
  const clipped = flat.length <= CELL_MAX ? flat : `${flat.slice(0, CELL_MAX)}...`;
  // Text can come from the audited page: no table breaks, no HTML, no markdown link or code span.
  return clipped
    .replace(/\|/g, '\\|')
    .replace(/[<>]/g, c => (c === '<' ? '&lt;' : '&gt;'))
    .replace(/[[\]]/g, c => `\\${c}`)
    .replace(/`/g, "'");
}

/**
 * @param {number | null} n
 * @return {string}
 */
function num(n) {
  return n === null ? 'n/a' : n.toFixed(1);
}

/**
 * @param {number | null} d
 * @return {string}
 */
function signed(d) {
  if (d === null) return 'n/a';
  return d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
}

/**
 * @param {AuditResult} issue
 * @return {string}
 */
function level(issue) {
  return issue.tier === 'error' ? (issue.status === 'fail' ? 'ERROR' : 'ERROR (partial)') : 'WARN';
}

/**
 * @param {RunSummary} run
 * @param {number} top
 * @param {number} guidance
 * @return {string[]}
 */
function runLines(run, top, guidance) {
  /** @type {string[]} */
  const out = [];
  const o = run.overall;
  out.push(`## ${cell(run.url) || 'Unknown URL'}`, '');
  out.push(
    `**Overall: ${num(o.score)} (grade ${o.grade})**. ${o.applicable} scored audits applied: ${
      o.passed
    } pass, ${o.warnings} partial, ${o.failures} fail. ` +
      `${run.auditsFound} of the fork's scored audits were in the report` +
      (run.auditErrors ? `, **${run.auditErrors} errored**` : '') +
      (run.lighthouseVersion ? ` (Lighthouse ${cell(run.lighthouseVersion)})` : '') +
      '.',
    ''
  );
  out.push('| Category | Score | Grade | Pass | Partial | Fail |', '|---|---|---|---|---|---|');
  for (const c of run.categories) {
    out.push(
      `| ${cell(c.name)} | ${num(c.score)} | ${c.grade} | ${c.passed} | ${c.warnings} | ${
        c.failures
      } |`
    );
  }
  out.push('');
  if (run.issues.length === 0) {
    out.push('**No issues.** Every applicable scored audit passed.', '');
    return out;
  }
  out.push(
    `### Issues, most important first (${Math.min(top, run.issues.length)} of ${
      run.issues.length
    })`,
    '',
    'Ranked by tier (error before warn), then by how many items the audit found.',
    '',
    '| # | Level | Audit | Category | Found | What it found |',
    '|---|---|---|---|---|---|'
  );
  run.issues.slice(0, top).forEach((issue, i) => {
    out.push(
      `| ${i + 1} | ${level(issue)} | \`${cell(issue.id)}\` | ${cell(issue.category)} | ${
        issue.reach
      } | ${cell(issue.displayValue || issue.explanation)} |`
    );
  });
  out.push('');
  if (guidance > 0) {
    out.push('### How to fix the top issues', '');
    for (const issue of run.issues.slice(0, guidance)) {
      out.push(`- **\`${cell(issue.id)}\`** (${level(issue)}): ${cell(issue.title)}`);
      if (issue.explanation) out.push(`  - What is wrong: ${cell(issue.explanation)}`);
      if (issue.description) out.push(`  - About this check: ${cell(issue.description)}`);
    }
    out.push('');
  }
  return out;
}

/**
 * @param {RunComparison} c
 * @return {string[]}
 */
function comparisonLines(c) {
  /** @type {string[]} */
  const out = [];
  out.push(
    `### Compared with the earlier run`,
    '',
    `Overall ${num(c.overallBefore)} to ${num(c.overallAfter)} (${signed(c.overallDelta)}).`,
    ''
  );
  const moved = c.categories.filter(x => x.delta !== null && x.delta !== 0);
  if (moved.length) {
    out.push('| Category | Before | After | Change |', '|---|---|---|---|');
    for (const x of moved) {
      out.push(`| ${cell(x.name)} | ${num(x.before)} | ${num(x.after)} | ${signed(x.delta)} |`);
    }
    out.push('');
  }
  /**
   * @param {string} title
   * @param {AuditResult[]} list
   */
  const list = (title, list) => {
    out.push(`**${title} (${list.length})**`, '');
    if (list.length === 0) out.push('- none');
    for (const r of list.slice(0, 15)) {
      out.push(
        `- \`${cell(r.id)}\` (${level(r)}): ${cell(r.displayValue || r.explanation || r.title)}`
      );
    }
    if (list.length > 15) out.push(`- and ${list.length - 15} more`);
    out.push('');
  };
  list('New issues', c.newIssues);
  list('Fixed', c.fixed);
  out.push(
    `**Still failing (${c.stillFailing.length})**: ${c.worse.length} worse, ${c.better.length} better, the rest unchanged.`,
    ''
  );
  return out;
}

/**
 * @param {{runs: RunSummary[], comparisons?: Map<string, RunComparison>, top?: number, guidance?: number, onlyInBefore?: string[], onlyInAfter?: string[]}} input
 * @return {string}
 */
function renderMarkdown({
  runs,
  comparisons = new Map(),
  top = 25,
  guidance = 10,
  onlyInBefore = [],
  onlyInAfter = [],
}) {
  /** @type {string[]} */
  const out = ['# SEO summary', ''];
  if (runs.length === 0) {
    out.push(
      '**No report was found.** Run `lhci collect` first, or point this command at the folder that holds the `lhr-*.json` files.'
    );
    return `${out.join('\n')}\n`;
  }
  if (runs.length > 1) {
    out.push('| Page | Score | Grade | Errors | Warnings |', '|---|---|---|---|---|');
    for (const r of runs) {
      const errors = r.issues.filter(i => i.tier === 'error').length;
      out.push(
        `| ${cell(r.url)} | ${num(r.overall.score)} | ${r.overall.grade} | ${errors} | ${
          r.issues.length - errors
        } |`
      );
    }
    out.push('');
  }
  for (const run of runs) {
    out.push(...runLines(run, top, guidance));
    const comparison = comparisons.get(run.url);
    if (comparison) out.push(...comparisonLines(comparison));
  }
  if (onlyInAfter.length) {
    out.push(`New pages with no earlier run: ${onlyInAfter.map(cell).join(', ')}`, '');
  }
  if (onlyInBefore.length) {
    out.push(`Pages in the earlier run but not this one: ${onlyInBefore.map(cell).join(', ')}`, '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/**
 * @param {{runs: RunSummary[], comparisons?: Map<string, RunComparison>}} input
 * @return {object} Plain data (no Map), ready for JSON.stringify.
 */
function toData({runs, comparisons = new Map()}) {
  return {
    runs: runs.map(r => ({
      url: r.url,
      fetchTime: r.fetchTime,
      lighthouseVersion: r.lighthouseVersion,
      overall: r.overall,
      categories: r.categories,
      issues: r.issues,
      auditErrors: r.auditErrors,
    })),
    comparisons: [...comparisons.values()],
  };
}

export {renderMarkdown, toData, cell};
