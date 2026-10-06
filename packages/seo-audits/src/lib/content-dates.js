/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `content-dates` audit: the published and modified dates a page declares (in
 * `article:published_time`-style meta tags and in JSON-LD `datePublished` / `dateModified`), checked against each
 * other. Fails only on a clear contradiction (chosen with the developer): a modified date earlier than the published
 * date, a date in the future, or two different published (or modified) dates. A day of tolerance covers time zones.
 * JSON-LD dates are read from the page's main entity only (an Article-like type or a WebPage), so a Review or an
 * Event in the same page cannot contradict it; `<meta name="date">` is shown but not judged, because sites use it
 * for either date.
 * The page's age is shown for information and never judged. Visible `<time>` elements are not judged (an event page
 * legitimately has future dates). No I/O, never throws.
 */

import {extractTypedEntities} from './json-ld-graph.js';
import {clip, hasContent, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{kind: 'published' | 'modified' | 'other', source: string, raw: string, time: number}} DeclaredDate */

const DAY_MS = 24 * 60 * 60 * 1000;
const TOLERANCE_MS = DAY_MS;
const MAX_JSON_LD_BLOCKS = 20;
const MAIN_TYPES = new Set([
  'Article',
  'NewsArticle',
  'BlogPosting',
  'TechArticle',
  'ScholarlyArticle',
  'Report',
  'WebPage',
  'ItemPage',
]);
const META_KINDS = /** @type {Record<string, 'published' | 'modified' | 'other'>} */ ({
  'article:published_time': 'published',
  datePublished: 'published',
  date: 'other',
  'article:modified_time': 'modified',
  dateModified: 'modified',
  'last-modified': 'modified',
});

/**
 * @param {string} raw
 * @return {number | null}
 */
function parseTime(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const time = Date.parse(raw.trim());
  if (!Number.isFinite(time)) return null;
  const year = new Date(time).getUTCFullYear();
  return year >= 1990 && year <= 2100 ? time : null;
}

/**
 * @param {unknown} content PageContent artifact
 * @param {unknown} jsonLd StructuredDataJsonLd artifact (entries with `content`)
 * @return {{dates: DeclaredDate[], unreadable: string[]}}
 */
function collectDates(content, jsonLd) {
  /** @type {DeclaredDate[]} */
  const dates = [];
  /** @type {string[]} */
  const unreadable = [];
  /**
   * @param {'published' | 'modified' | 'other'} kind
   * @param {string} source
   * @param {unknown} raw
   */
  const add = (kind, source, raw) => {
    if (typeof raw !== 'string') return;
    const time = parseTime(raw);
    if (time === null) unreadable.push(`${source}: ${clip(raw, 40)}`);
    else dates.push({kind, source, raw: raw.trim().slice(0, 40), time});
  };
  const metas = hasContent(content) && Array.isArray(content.metaDates) ? content.metaDates : [];
  for (const m of metas) {
    const kind = m && META_KINDS[m.key];
    if (kind) add(kind, `<meta ${m.key}>`, m.value);
  }
  const blocks = Array.isArray(jsonLd) ? jsonLd.slice(0, MAX_JSON_LD_BLOCKS) : [];
  /** @type {Array<ReturnType<typeof extractTypedEntities>[number]>} */
  const entities = [];
  for (const block of blocks) {
    if (block && typeof block.content === 'string') {
      entities.push(...extractTypedEntities(block.content));
    }
  }
  const hasDate = (/** @type {{data: Record<string, unknown>}} */ e) =>
    e.data.datePublished !== undefined || e.data.dateModified !== undefined;
  const main = entities.find(e => MAIN_TYPES.has(e.type) && hasDate(e)) || entities.find(hasDate);
  if (main) {
    add('published', `JSON-LD ${main.type} datePublished`, main.data.datePublished);
    add('modified', `JSON-LD ${main.type} dateModified`, main.data.dateModified);
  }
  return {dates, unreadable};
}

/**
 * @param {number} time
 * @return {string}
 */
function day(time) {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * @param {unknown} content PageContent artifact
 * @param {unknown} jsonLd StructuredDataJsonLd artifact
 * @param {unknown} fetchTime The run's ISO time
 * @return {Product}
 */
function buildContentDatesProduct(content, jsonLd, fetchTime) {
  if (!hasContent(content)) return notApplicable('The page content was not collected.');
  const {dates, unreadable} = collectDates(content, jsonLd);
  if (dates.length === 0) {
    return notApplicable(
      unreadable.length
        ? `The page declares dates it could not read (${unreadable.slice(0, 2).join('; ')}).`
        : 'The page declares no published or modified date.'
    );
  }
  const now =
    typeof fetchTime === 'string' && Number.isFinite(Date.parse(fetchTime))
      ? Date.parse(fetchTime)
      : Date.now();
  /** @type {string[]} */
  const problems = [];
  const published = dates.filter(d => d.kind === 'published');
  const modified = dates.filter(d => d.kind === 'modified');
  if (published.length === 0 && modified.length === 0) {
    return notApplicable(
      'The page declares only a generic date tag (<meta name="date">), which can mean either date, so it is not judged.'
    );
  }
  if (modified.length > 0 && published.length > 0) {
    const earliestModified = modified.reduce((x, y) => (y.time < x.time ? y : x));
    const latestPublished = published.reduce((x, y) => (y.time > x.time ? y : x));
    if (earliestModified.time < latestPublished.time - TOLERANCE_MS) {
      problems.push(
        `the modified date ${day(earliestModified.time)} (${
          earliestModified.source
        }) is before the published date ${day(latestPublished.time)} (${latestPublished.source})`
      );
    }
  }
  for (const d of [...published, ...modified]) {
    if (d.time > now + TOLERANCE_MS) {
      problems.push(`the ${d.kind} date ${day(d.time)} (${d.source}) is in the future`);
    }
  }
  for (const [label, group] of /** @type {Array<[string, DeclaredDate[]]>} */ ([
    ['published', published],
    ['modified', modified],
  ])) {
    const min = Math.min(...group.map(d => d.time));
    const max = Math.max(...group.map(d => d.time));
    if (group.length > 1 && max - min > TOLERANCE_MS) {
      problems.push(`two different ${label} dates are declared (${day(min)} and ${day(max)})`);
    }
  }
  const unique = [...new Set(problems)];
  /** @type {Array<Record<string, string>>} */
  const rows = unique.map(p => ({what: 'Problem', value: p}));
  for (const d of dates) {
    rows.push({
      what: d.kind === 'other' ? 'date (not judged)' : `${d.kind} date`,
      value: `${d.raw} (${d.source})`,
    });
  }
  for (const u of unreadable.slice(0, 3)) rows.push({what: 'unreadable date', value: u});
  const latest = Math.max(...(modified.length ? modified : published).map(d => d.time));
  const age = Math.max(0, Math.floor((now - latest) / DAY_MS));
  const headings = /** @type {Array<[string, string]>} */ ([
    ['what', 'Item'],
    ['value', 'Value'],
  ]);
  if (unique.length > 0) {
    return {
      score: 0,
      displayValue: `${unique.length} date ${
        unique.length === 1 ? 'contradiction' : 'contradictions'
      }`,
      explanation: `The page declares dates that cannot all be true: ${unique[0]}. Search engines and readers use these dates to judge how fresh a page is; make them agree.`,
      details: table(rows, headings),
    };
  }
  return {
    score: 1,
    displayValue: `${modified.length ? 'Last modified' : 'Published'} ${day(latest)} (${age} ${
      age === 1 ? 'day' : 'days'
    } ago)`,
    details: table(rows, headings),
  };
}

export {buildContentDatesProduct, collectDates, parseTime};
