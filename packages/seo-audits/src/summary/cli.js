#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `seo-summary`: reads the results `lhci collect` wrote and prints a summary of the fork's SEO audits: a score per
 * category and overall, the issues ranked by importance with the audits' own explanations, and, with `--compare`,
 * what is new, fixed and still failing since an earlier run. Reads local files only. Always exits 0 on success (it
 * reports; gating belongs to `lhci assert`); exits 2 on a usage error.
 *
 *   node packages/seo-audits/src/summary/cli.js .lighthouseci
 *   node packages/seo-audits/src/summary/cli.js .lighthouseci --compare previous/.lighthouseci --format json
 */

import fs from 'fs';
import {fileURLToPath} from 'url';
import {summarizeRun} from './run-summary.js';
import {compareAll} from './compare.js';
import {renderMarkdown, toData} from './render.js';
import {loadLhrs} from './load.js';
import {toSarif, isRepoPath} from './sarif.js';

const USAGE = `Usage: seo-summary <folder-or-lhr.json> [--compare <earlier-folder>] [--format markdown|json|sarif] [--sarif-file <repo path>] [--top N] [--guidance N] [--out file]

  <folder>      where lhci wrote its lhr-*.json files (usually .lighthouseci)
  --compare     an earlier report folder: lists new, fixed and still-failing issues per page
  --format      markdown (default), json, or sarif (SARIF 2.1.0 for GitHub code scanning and other dashboards)
  --sarif-file  with --format sarif: a file in your repository to attach every result to (GitHub only shows alerts
                that point at a repository file; the page URL stays in each message). Default: the page URL.
  --top         how many issues to list per page (default 25)
  --guidance    how many of the top issues get fix guidance (default 10)
  --out         write to this file instead of the terminal
`;

/**
 * @param {string[]} argv
 * @return {{location?: string, compare?: string, format: string, sarifFile?: string, top: number, guidance: number, out?: string, help: boolean, error?: string}}
 */
function parseArgs(argv) {
  /** @type {ReturnType<typeof parseArgs>} */
  const args = {format: 'markdown', top: 25, guidance: 10, help: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--compare') args.compare = value();
    else if (a === '--format') args.format = String(value());
    else if (a === '--sarif-file') args.sarifFile = value();
    else if (a === '--top') args.top = Number(value());
    else if (a === '--guidance') args.guidance = Number(value());
    else if (a === '--out') args.out = value();
    else if (a.startsWith('--')) args.error = `Unknown option ${a}`;
    else if (!args.location) args.location = a;
    else args.error = 'Only one report folder can be given (use --compare for a second).';
  }
  if (!['markdown', 'json', 'sarif'].includes(args.format)) {
    args.error = '--format must be markdown, json or sarif';
  }
  if (args.sarifFile !== undefined && !isRepoPath(args.sarifFile)) {
    args.error = '--sarif-file must be a relative path inside the repository, without ".."';
  }
  if (!Number.isInteger(args.top) || args.top < 1) {
    args.error = '--top must be a whole number of at least 1';
  }
  if (!Number.isInteger(args.guidance) || args.guidance < 0) {
    args.error = '--guidance must be a whole number, 0 or more';
  }
  return args;
}

/**
 * @param {string} location
 * @param {Record<string, [string, unknown]>} recommended
 */
function summarizeFolder(location, recommended) {
  const {lhrs, skipped} = loadLhrs(location);
  return {runs: lhrs.map(lhr => summarizeRun(lhr, recommended)), skipped};
}

function packageVersion() {
  try {
    // @ts-expect-error - `import.meta` is valid ESM syntax; this file runs as real ESM (see rule-engine/registry.js).
    const file = fileURLToPath(new URL('../../package.json', import.meta.url));
    return String(JSON.parse(fs.readFileSync(file, 'utf8')).version);
  } catch (_) {
    return '0.0.0';
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.error || !args.location) {
    process.stderr.write(
      `${args.error || 'Give the folder that holds the lhr-*.json files.'}\n\n${USAGE}`
    );
    return 2;
  }
  // @ts-expect-error - `import.meta` is valid ESM syntax; this file runs as real ESM (see rule-engine/registry.js).
  const presetPath = fileURLToPath(new URL('../recommended-assertions.json', import.meta.url));
  const recommended = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
  const now = summarizeFolder(args.location, recommended);
  /** @type {ReturnType<typeof compareAll> | null} */
  let compared = null;
  /** @type {string[]} */
  let skipped = now.skipped;
  if (args.compare) {
    const before = summarizeFolder(args.compare, recommended);
    skipped = [...skipped, ...before.skipped];
    compared = compareAll(before.runs, now.runs);
  }
  const comparisons = compared ? compared.comparisons : undefined;
  const output =
    args.format === 'sarif'
      ? `${JSON.stringify(
          toSarif(now.runs, {toolVersion: packageVersion(), fileUri: args.sarifFile || null}),
          null,
          2
        )}\n`
      : args.format === 'json'
      ? `${JSON.stringify({...toData({runs: now.runs, comparisons}), skipped}, null, 2)}\n`
      : renderMarkdown({
          runs: now.runs,
          comparisons,
          top: args.top,
          guidance: args.guidance,
          onlyInBefore: compared ? compared.onlyInBefore : [],
          onlyInAfter: compared ? compared.onlyInAfter : [],
        }) + (skipped.length ? `\nSkipped: ${skipped.join('; ')}\n` : '');
  if (args.out) fs.writeFileSync(args.out, output);
  else process.stdout.write(output);
  return 0;
}

process.exitCode = main();
