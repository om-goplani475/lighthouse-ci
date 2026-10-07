/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Template detection for the site crawl. Pages that share a template (`/blog/:slug`, `/products/shoes/:slug`) usually
 * share their problems, so a problem found on most of a template's pages is one fix in one file, not many pages to edit.
 * This groups the crawled pages by the shape of their address and counts, per group, the page-level problems each page
 * has in the snapshot. Pure: no I/O, never throws, reads only the snapshot (no request).
 *
 * Grouping is by the data, not by a list of known names: inside a group of pages with the same depth and the same
 * leading path, a position whose values are mostly different (at least 3 distinct values, and at least 60% of the
 * pages) is a variable part (`:slug`, or `:id` when every value is a number); anywhere else the value is kept. The first
 * path part is never a variable (`/about`, `/pricing`, `/contact` are three single pages, not one template). A template
 * needs at least 3 pages. This is a heuristic on the pages the crawl reached, not a model of the site's routing.
 */

import {clip, count, notApplicable, table, usableSnapshot} from './vertical-common.js';
import {THIN_WORD_COUNT} from './crawl-thin.js';

/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/**
 * @typedef {{
 *   pattern: string, pages: number, examples: string[],
 *   problems: Array<{key: string, label: string, count: number}>,
 *   systemic: Array<{key: string, label: string, count: number}>,
 * }} Template
 */

const MIN_TEMPLATE_PAGES = 3;
const MIN_DISTINCT = 3;
const VARIABLE_SHARE = 0.6;
const SYSTEMIC_SHARE = 0.8;
const MAX_TEMPLATES = 20;
const MAX_EXAMPLES = 3;
const MAX_SEGMENT_CHARS = 40;

/** What is counted, in the order it is shown. */
const PROBLEMS = [
  {key: 'errorStatus', label: 'an error or no reply'},
  {key: 'noindex', label: 'noindex'},
  {key: 'missingTitle', label: 'no title'},
  {key: 'duplicateTitle', label: 'a title shared with another page'},
  {key: 'missingDescription', label: 'no meta description'},
  {key: 'missingH1', label: 'no h1'},
  {key: 'multipleH1', label: 'more than one h1'},
  {key: 'noCanonical', label: 'no canonical link'},
  {key: 'thinContent', label: `under ${THIN_WORD_COUNT} words of text`},
  {key: 'noStructuredData', label: 'no structured data'},
];

/**
 * @param {string} url
 * @return {string[] | null} The path parts without the query, or null when the address cannot be read.
 */
function segmentsOf(url) {
  try {
    return new URL(url).pathname
      .split('/')
      .filter(Boolean)
      .map(s => {
        try {
          return decodeURIComponent(s);
        } catch (_) {
          return s;
        }
      })
      .map(s => clip(s, MAX_SEGMENT_CHARS));
  } catch (_) {
    return null;
  }
}

/**
 * @param {Array<{url: string, segs: string[]}>} items All with the same number of path parts.
 * @param {number} pos
 * @param {string[]} prefix
 * @param {Map<string, string>} out Address to pattern.
 */
function resolve(items, pos, prefix, out) {
  const depth = items[0].segs.length;
  if (pos >= depth) {
    for (const item of items) out.set(item.url, `/${prefix.join('/')}`);
    return;
  }
  const values = new Set(items.map(i => i.segs[pos]));
  const variable =
    pos > 0 &&
    items.length >= MIN_TEMPLATE_PAGES &&
    values.size >= MIN_DISTINCT &&
    values.size >= items.length * VARIABLE_SHARE;
  if (variable) {
    const token = [...values].every(v => /^\d+$/.test(v)) ? ':id' : ':slug';
    resolve(items, pos + 1, [...prefix, token], out);
    return;
  }
  /** @type {Map<string, Array<{url: string, segs: string[]}>>} */
  const parts = new Map();
  for (const item of items) {
    const key = item.segs[pos];
    const list = parts.get(key);
    if (list) list.push(item);
    else parts.set(key, [item]);
  }
  for (const [value, list] of parts) resolve(list, pos + 1, [...prefix, value], out);
}

/**
 * @param {string[]} urls
 * @return {Map<string, string>} Address to pattern (`/blog/:slug`); a page that is alone in its shape has a plain path.
 */
function patternsFor(urls) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {Map<number, Array<{url: string, segs: string[]}>>} */
  const byDepth = new Map();
  for (const url of urls) {
    const segs = segmentsOf(url);
    if (!segs) continue;
    if (segs.length === 0) {
      out.set(url, '/');
      continue;
    }
    const list = byDepth.get(segs.length);
    if (list) list.push({url, segs});
    else byDepth.set(segs.length, [{url, segs}]);
  }
  for (const items of byDepth.values()) resolve(items, 0, [], out);
  return out;
}

/** @param {CrawlPage} page @return {boolean} */
function isNoindex(page) {
  const meta = (page.robotsMetas || []).some(
    m => /^(robots|googlebot)$/i.test(m.name) && /noindex|none/i.test(m.content)
  );
  return meta || (page.xRobotsTag || []).some(v => /noindex|none/i.test(v));
}

/**
 * @param {CrawlPage[]} pages
 * @return {Map<string, number>} Title (trimmed, lower case) to how many page-like crawled pages carry it.
 */
function titleCounts(pages) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const p of pages) {
    const t = (p.title || '').trim().toLowerCase();
    if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

/**
 * @param {CrawlPage} page
 * @param {Map<string, number>} titles
 * @return {string[]} The keys of `PROBLEMS` this page has.
 */
function problemsOf(page, titles) {
  const found = [];
  const ok = page.status !== null && page.status >= 200 && page.status < 300;
  if (!ok) return ['errorStatus'];
  if (page.extraction !== 'ok') return found; // not HTML: nothing else can be judged
  if (isNoindex(page)) found.push('noindex');
  const title = (page.title || '').trim();
  if (!title) found.push('missingTitle');
  else if ((titles.get(title.toLowerCase()) || 0) > 1) found.push('duplicateTitle');
  if (!(page.description || '').trim()) found.push('missingDescription');
  const h1 = (page.h1 || []).filter(h => h.trim()).length;
  if (h1 === 0) found.push('missingH1');
  else if (h1 > 1) found.push('multipleH1');
  if (!(page.canonicals || []).length) found.push('noCanonical');
  if (!page.truncated && page.wordCount < THIN_WORD_COUNT) found.push('thinContent');
  if (!(page.entities || []).length) found.push('noStructuredData');
  return found;
}

/**
 * @param {CrawlPage[]} pages The pages the crawl reached.
 * @return {{templates: Template[], singles: number, total: number}} Templates with at least 3 pages, largest first (at
 *   most 20); `singles` is how many pages are in no template.
 */
function groupTemplates(pages) {
  const list = pages.filter(p => p && typeof p.url === 'string');
  const patterns = patternsFor(list.map(p => p.url));
  const titles = titleCounts(
    list.filter(p => p.status !== null && p.status >= 200 && p.status < 300)
  );
  /** @type {Map<string, CrawlPage[]>} */
  const groups = new Map();
  for (const page of list) {
    const pattern = patterns.get(page.url);
    if (!pattern) continue;
    const g = groups.get(pattern);
    if (g) g.push(page);
    else groups.set(pattern, [page]);
  }
  /** @type {Template[]} */
  const templates = [];
  let singles = 0;
  for (const [pattern, members] of groups) {
    if (!pattern.includes(':') || members.length < MIN_TEMPLATE_PAGES) {
      singles += members.length;
      continue;
    }
    /** @type {Map<string, number>} */
    const tally = new Map();
    for (const p of members) {
      for (const k of problemsOf(p, titles)) tally.set(k, (tally.get(k) || 0) + 1);
    }
    const problems = PROBLEMS.filter(d => tally.has(d.key)).map(d => ({
      key: d.key,
      label: d.label,
      count: /** @type {number} */ (tally.get(d.key)),
    }));
    templates.push({
      pattern,
      pages: members.length,
      examples: members.slice(0, MAX_EXAMPLES).map(p => clip(p.finalUrl || p.url)),
      problems,
      systemic: problems.filter(
        p => p.count >= MIN_TEMPLATE_PAGES && p.count >= members.length * SYSTEMIC_SHARE
      ),
    });
  }
  templates.sort((a, b) => b.pages - a.pages || a.pattern.localeCompare(b.pattern));
  return {templates: templates.slice(0, MAX_TEMPLATES), singles, total: list.length};
}

/**
 * @param {unknown} value A value read from a report or from storage.
 * @return {Template[]} The templates in it that have the expected shape, bounded; anything else is dropped.
 */
function reviveTemplates(value) {
  if (!Array.isArray(value)) return [];
  const text = (/** @type {unknown} */ v, /** @type {number} */ max) =>
    typeof v === 'string' ? clip(v, max) : null;
  const countOf = (/** @type {unknown} */ v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  /** @param {unknown} list */
  const problemList = list =>
    (Array.isArray(list) ? list : []).slice(0, PROBLEMS.length).flatMap(p => {
      const key = text(p && p.key, 40);
      const label = text(p && p.label, 120);
      const n = countOf(p && p.count);
      return key && label && n !== null ? [{key, label, count: n}] : [];
    });
  /** @type {Template[]} */
  const out = [];
  for (const t of value.slice(0, MAX_TEMPLATES)) {
    const pattern = text(t && t.pattern, 200);
    const pages = countOf(t && t.pages);
    if (!pattern || pages === null) continue;
    out.push({
      pattern,
      pages,
      examples: (Array.isArray(t.examples) ? t.examples : [])
        .slice(0, MAX_EXAMPLES)
        .flatMap((/** @type {unknown} */ e) => (typeof e === 'string' ? [clip(e, 300)] : [])),
      problems: problemList(t.problems),
      systemic: problemList(t.systemic),
    });
  }
  return out;
}

/**
 * @param {Template} t
 * @return {string}
 */
function describeProblems(t) {
  if (t.problems.length === 0) return 'no page-level problem found';
  return t.problems
    .map(
      p =>
        `${p.count} of ${t.pages} pages with ${p.label}${
          t.systemic.includes(p) ? ' (one fix in the template)' : ''
        }`
    )
    .join('; ');
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {Product} Informational: never fails.
 */
function templateReportProduct(artifact) {
  const usable = usableSnapshot(artifact);
  if ('reason' in usable) return notApplicable(usable.reason);
  const {templates, singles, total} = groupTemplates(usable.snapshot.pages);
  if (templates.length === 0) {
    return notApplicable(
      `No group of at least ${MIN_TEMPLATE_PAGES} pages with the same address shape was found among the ${count(
        total,
        'crawled page'
      )}.`
    );
  }
  const systemic = templates.reduce((n, t) => n + t.systemic.length, 0);
  const product = {
    score: 1,
    displayValue: `${count(templates.length, 'template')}, ${systemic} shared ${
      systemic === 1 ? 'problem' : 'problems'
    }`,
    details: table(
      [
        {key: 'pattern', heading: 'Template'},
        {key: 'pages', heading: 'Pages'},
        {key: 'problems', heading: 'Problems found on its pages'},
        {key: 'example', heading: 'Example'},
      ],
      templates.map(t => ({
        pattern: clip(t.pattern),
        pages: String(t.pages),
        problems: clip(describeProblems(t), 400),
        example: t.examples[0] || '',
      }))
    ),
  };
  // The same groups as plain data, for the SEO service's dashboard (the table above is text for the report).
  /** @type {any} */ (product.details).templates = templates;
  /** @type {any} */ (product.details).singles = singles;
  return product;
}

export {
  reviveTemplates,
  groupTemplates,
  patternsFor,
  templateReportProduct,
  problemsOf,
  PROBLEMS,
  MIN_TEMPLATE_PAGES,
  MAX_TEMPLATES,
};
