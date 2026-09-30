/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure structural check of an `llms.txt` file against the format at llmstxt.org (Jeremy Howard's
 * proposal, September 2024; a proposal, not a ratified standard). What that page specifies:
 *
 * - Only the **H1** (the name of the project or site) is required.
 * - Optional: a blockquote summary, other markdown, and **H2 sections** holding lists of links in
 *   the form `[name](url)`, optionally followed by a colon and notes; an "Optional" section marks
 *   links an agent may skip.
 *
 * Failures are limited to unambiguous violations: no H1; a list item that starts like a link but is
 * not one (`[name]` with no URL); an empty or unsupported link URL; and a file that is really an
 * HTML page (a single-page app answering every path with its index page, the most common way
 * `/llms.txt` "exists" but is not one).
 *
 * Deliberately NOT failures, because real files from major sites do them and failing those would
 * make this audit noise: plain-text list items or a link embedded mid-sentence in a link section,
 * a section with no links at all, and indented sub-bullets used as notes. Those, and the optional
 * parts (no summary, no sections, an H1 that is not first, several H1s), are reported as notes.
 * This is a judgment call about usefulness, not something llmstxt.org states.
 */

/**
 * @typedef {{line: number | null, problem: string}} LlmsProblem
 * @typedef {{
 *   title: string | null,
 *   problems: LlmsProblem[],
 *   notes: string[],
 *   sectionCount: number,
 *   linkCount: number,
 * }} LlmsAnalysis
 */

const HTML_START = /^\s*(<!doctype\s+html|<html[\s>])/i;
const ITEM_START = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const LEADING_LINK = /^\[([^\]]*)\]\(([^)]*)\)(.*)$/;

/**
 * @param {string} url
 * @return {string | null} The reason the link target is unusable, or null.
 */
function urlProblem(url) {
  const trimmed = url.trim();
  if (!trimmed) return 'the link has an empty URL';
  // A scheme other than http(s) (mailto:, javascript:, ...) is not a page an agent can read.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (scheme && !/^https?$/i.test(scheme[1])) return `the link uses the "${scheme[1]}:" scheme`;
  return null;
}

/**
 * @param {string} raw
 * @return {LlmsAnalysis}
 */
function analyzeLlmsTxt(raw) {
  // The format allows a byte-order mark; checked by code point, since a literal BOM inside a regex
  // is invisible and tools rewrite it.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  /** @type {LlmsAnalysis} */
  const analysis = {title: null, problems: [], notes: [], sectionCount: 0, linkCount: 0};

  if (HTML_START.test(text)) {
    analysis.problems.push({
      line: 1,
      problem:
        'the file is an HTML page, not markdown (a single-page app answering every path with its index page?)',
    });
    return analysis;
  }

  const lines = text.split(/\r\n|\r|\n/);
  /** @type {number[]} */
  const h1Lines = [];
  /** @type {number | null} */
  let firstContentLine = null;
  let inFence = false;
  let hasBlockquote = false;
  /** @type {{name: string, items: number, loose: number[]} | null} */
  let section = null;
  /** @type {Array<{name: string, items: number, loose: number[]}>} */
  const sections = [];
  /** @type {number[]} */
  const noColonLines = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      return;
    }
    if (inFence || trimmed === '') return;
    if (firstContentLine === null) firstContentLine = lineNumber;

    if (/^#\s+\S/.test(line)) {
      h1Lines.push(lineNumber);
      if (analysis.title === null) {
        analysis.title = line.replace(/^#\s+/, '').replace(/\s+#*\s*$/, '');
      }
      section = null;
      return;
    }
    if (/^##\s+\S/.test(line)) {
      section = {name: line.replace(/^##\s+/, '').replace(/\s+#*\s*$/, ''), items: 0, loose: []};
      sections.push(section);
      return;
    }
    if (/^#{3,6}\s/.test(line)) return;
    if (trimmed.startsWith('>')) {
      hasBlockquote = true;
      return;
    }

    // Only list items inside an H2 section are the format's "file list"; prose and lists before
    // the first H2 are free-form markdown.
    const item = section ? ITEM_START.exec(line) : null;
    if (!section || !item) return;

    // An indented item is a sub-bullet elaborating the link above it (real files use these as
    // notes), not a list entry of its own.
    if (item[1].length >= 2) return;
    const text = item[2].trim();
    const link = LEADING_LINK.exec(text);
    if (!link) {
      if (text.startsWith('[')) {
        // Starts like a link but is not one (`[name]` with no URL, `[name] (url)`): a clear
        // attempt at the format that is broken.
        analysis.problems.push({
          line: lineNumber,
          problem: `list item in "${section.name}" starts like a link but is not in [name](url) form`,
        });
      } else {
        // Plain text or a link embedded mid-sentence: not the format's shape, but not broken
        // either. Reported (collapsed) as a note, never a failure.
        section.loose.push(lineNumber);
      }
      return;
    }
    const problem = urlProblem(link[2]);
    if (problem) {
      analysis.problems.push({line: lineNumber, problem: `${problem} in "${section.name}"`});
      return;
    }
    section.items += 1;
    analysis.linkCount += 1;
    const rest = link[3].trim();
    if (rest && !rest.startsWith(':')) noColonLines.push(lineNumber);
  });

  analysis.sectionCount = sections.length;

  let looseInLinkSections = 0;
  let firstLoose = null;
  for (const {name, items, loose} of sections) {
    if (items > 0) {
      looseInLinkSections += loose.length;
      if (loose.length && firstLoose === null) firstLoose = loose[0];
    } else {
      analysis.notes.push(
        loose.length
          ? `section "${name}" has no links (its ${loose.length} list item(s) are plain text, which the format allows)`
          : `section "${name}" has no links`
      );
    }
  }
  if (looseInLinkSections) {
    analysis.notes.push(
      `${looseInLinkSections} list item(s) in link sections are not [name](url) links (first at line ${firstLoose})`
    );
  }
  analysis.problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  if (h1Lines.length === 0) {
    analysis.problems.unshift({
      line: null,
      problem: 'no H1 title (the only part the format requires)',
    });
  } else {
    if (h1Lines[0] !== firstContentLine) {
      analysis.notes.push('the H1 is not the first thing in the file');
    }
    if (h1Lines.length > 1) {
      analysis.notes.push(`${h1Lines.length} H1 headings (the format has one)`);
    }
  }
  if (!hasBlockquote) analysis.notes.push('no blockquote summary (optional)');
  if (sections.length === 0) analysis.notes.push('no H2 sections of links (optional)');
  if (noColonLines.length) {
    analysis.notes.push(
      `${noColonLines.length} link(s) are followed by text that does not start with a colon ` +
        `(first at line ${noColonLines[0]})`
    );
  }
  return analysis;
}

export {analyzeLlmsTxt};
