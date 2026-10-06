/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the Lighthouse results (`lhr-*.json`) that `lhci collect` wrote. The only I/O of the summary command: it reads
 * local files, sends nothing anywhere. Bounded: at most 200 files, 50 MiB each; anything that is not a Lighthouse
 * result is skipped and named.
 */

import fs from 'fs';
import path from 'path';
import {looseKey} from '../lib/url-key.js';

const MAX_FILES = 200;
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * @param {string} location A folder holding `lhr-*.json` files, or one such file.
 * @return {{lhrs: any[], skipped: string[]}} One result per page (the latest when a page has several runs).
 */
function loadLhrs(location) {
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  let files = [];
  let stat;
  try {
    stat = fs.statSync(location);
  } catch {
    return {lhrs: [], skipped: [`${location}: not found`]};
  }
  if (stat.isDirectory()) {
    files = fs
      .readdirSync(location)
      .filter((/** @type {string} */ f) => /^lhr-.*\.json$/.test(f))
      .sort()
      .slice(0, MAX_FILES)
      .map((/** @type {string} */ f) => path.join(location, f));
  } else {
    files = [location];
  }
  /** @type {Map<string, any>} */
  const latest = new Map();
  for (const file of files) {
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        skipped.push(`${file}: larger than ${MAX_BYTES / 1024 / 1024} MiB`);
        continue;
      }
      const lhr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!lhr || typeof lhr !== 'object' || typeof lhr.audits !== 'object' || !lhr.audits) {
        skipped.push(`${file}: not a Lighthouse result`);
        continue;
      }
      const key = looseKey(lhr.finalDisplayedUrl || lhr.finalUrl || lhr.requestedUrl) || file;
      const old = latest.get(key);
      if (!old || String(lhr.fetchTime) >= String(old.fetchTime)) latest.set(key, lhr);
    } catch (err) {
      skipped.push(`${file}: ${err instanceof Error ? err.message : 'unreadable'}`);
    }
  }
  return {lhrs: [...latest.values()], skipped};
}

export {loadLhrs, MAX_FILES, MAX_BYTES};
