/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builders for the Phase 12 rendering audits: does the page a crawler reads (the raw HTML)
 * match the page a browser builds (the DOM after JavaScript), and does a server send the same page to a
 * mobile and a desktop user-agent? Both sides of every comparison are read with the same extractor
 * (`crawl-extract.js`), so a difference is a difference in the HTML, not in how it was parsed. No I/O,
 * never throws.
 *
 * Rules, chosen with the developer and refined after review: a noindex that changes, or two different canonicals,
 * fails; a title or description that exists only after JavaScript (or changes) is a note, because Google renders JavaScript; links and visible text that exist only after JavaScript fail past a
 * share (more than 20% of the internal links, more than half the words) and are otherwise a note.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {extractPage} from './crawl-extract.js';
import {normalizeUrl} from './crawl-snapshot.js';
import {noindexFor} from './robots-directives.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/**
 * @typedef {{
 *   title: string, description: string, canonical: string, canonicalCount: number, noindex: boolean,
 *   h1: string[], words: number, links: Set<string>,
 * }} PageSnapshot
 */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const LINK_SHARE_FAIL = 0.2;
const LINK_MIN_DIFFERENT = 3;
const WORD_SHARE_FAIL = 0.5;
const MIN_WORDS_TO_JUDGE = 50;
const SERVER_RENDERED_RATIO = 0.9;
const CLIENT_RENDERED_RATIO = 0.2;
const MIN_WORDS_TO_CLASSIFY = 30;
const MAX_CONSOLE_CHARS = 2_000;

/** Evidence of a framework in the raw HTML, and what it usually means. */
/** @type {Array<[RegExp, string]>} */
const FRAMEWORK_HINTS = [
  [/__next_data__|id="__next"/i, 'Next.js'],
  [/id="__nuxt"|window\.__nuxt__|__nuxt_data__/i, 'Nuxt'],
  [/data-server-rendered="true"/i, 'Vue server rendering'],
  [/ng-version=|ng-server-context/i, 'Angular'],
  [/data-reactroot/i, 'React server rendering'],
  [/<astro-island|data-astro-/i, 'Astro'],
  [/data-sveltekit|sveltekit/i, 'SvelteKit'],
  [/window\.__remixcontext|data-remix/i, 'Remix'],
  [/<div id="(root|app)"><\/div>/i, 'an empty root element (a client-rendered shell)'],
];
const HYDRATION_ERROR =
  /hydrat\w*\s+(failed|error|mismatch)|(text content|content) does not match server-rendered|error while hydrating|hydration (node|children|text|class|attribute) mismatch|\bNG050[0-9]\b/i;

/**
 * @param {string} text
 * @param {number} [max]
 * @return {string}
 */
function clip(text, max = MAX_CELL_CHARS) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

/**
 * @param {string | null | undefined} text
 * @return {string}
 */
function tidy(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/**
 * @param {unknown} html
 * @param {string} url
 * @param {boolean} [truncated]
 * @return {PageSnapshot | null}
 */
function snapshotOf(html, url, truncated = false) {
  if (typeof html !== 'string' || html.trim() === '') return null;
  const page = extractPage(html, url, {truncated});
  const canonicals = page.canonicals
    .map(c => normalizeUrl(c, url))
    .filter(/** @return {c is string} */ c => c !== null);
  return {
    title: tidy(page.title),
    description: tidy(page.description),
    canonical: canonicals[0] || '',
    canonicalCount: canonicals.length,
    noindex: noindexFor(['googlebot'], {metas: page.robotsMetas, xRobotsTag: []}).length > 0,
    h1: page.h1.map(tidy).filter(Boolean),
    words: page.wordCount,
    links: new Set(page.links.map(l => l.url)),
  };
}

/**
 * @param {unknown} html
 * @param {unknown} rendered
 * @param {string} url
 * @return {{raw: PageSnapshot, rendered: PageSnapshot} | null}
 */
function pairOf(html, rendered, url) {
  const renderedHtml =
    rendered && typeof rendered === 'object' ? /** @type {any} */ (rendered) : null;
  if (!renderedHtml || typeof url !== 'string') return null;
  const raw = snapshotOf(html, url);
  const live = snapshotOf(renderedHtml.html, url, !!renderedHtml.truncated);
  return raw && live ? {raw, rendered: live} : null;
}

const NOT_COLLECTED = 'The raw or the rendered HTML of the page was not collected.';

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {Array<Record<string, string>>} rows
 * @param {Array<[string, string]>} columns [key, label]
 * @return {import('lighthouse/types/audit.js').default.Details.Table}
 */
function table(rows, columns) {
  const shown = rows.slice(0, MAX_ROWS);
  const items = [...shown];
  if (rows.length > shown.length) {
    /** @type {Record<string, string>} */
    const more = {};
    columns.forEach(
      ([key], i) => (more[key] = i === 0 ? `${rows.length - shown.length} more not shown` : '')
    );
    items.push(more);
  }
  return Audit.makeTableDetails(
    columns.map(([key, label]) => ({key, valueType: /** @type {const} */ ('text'), label})),
    items
  );
}

/**
 * The head fields that differ between two snapshots (raw first), as table rows.
 * @param {PageSnapshot} a
 * @param {PageSnapshot} b
 * @return {Array<{field: string, a: string, b: string, problem: string}>}
 */
function headDifferences(a, b) {
  /** @type {Array<{field: string, a: string, b: string, problem: string}>} */
  const rows = [];
  /**
   * @param {string} field
   * @param {string} x
   * @param {string} y
   */
  const text = (field, x, y) => {
    if (x === y) return;
    rows.push({
      field,
      a: x ? clip(x, 120) : '(none)',
      b: y ? clip(y, 120) : '(none)',
      problem: !x ? 'second-only' : !y ? 'first-only' : 'differs',
    });
  };
  text('Title', a.title, b.title);
  text('Meta description', a.description, b.description);
  text('Canonical', a.canonical, b.canonical);
  if (a.noindex !== b.noindex) {
    rows.push({
      field: 'Robots (noindex)',
      a: a.noindex ? 'noindex' : 'indexable',
      b: b.noindex ? 'noindex' : 'indexable',
      problem: 'differs',
    });
  }
  return rows;
}

/**
 * @param {string} first
 * @param {string} second
 * @param {Array<{field: string, a: string, b: string, problem: string}>} rows
 * @return {Array<Record<string, string>>}
 */
function labelled(first, second, rows) {
  return rows.map(r => ({
    field: r.field,
    first: r.a,
    second: r.b,
    problem:
      r.problem === 'second-only'
        ? `only ${second}`
        : r.problem === 'first-only'
        ? `only ${first}`
        : r.problem,
  }));
}

/**
 * Head signals that exist only after JavaScript, or that JavaScript changes.
 * @param {unknown} html MainDocumentContent
 * @param {unknown} rendered RenderedHtml artifact
 * @param {string} url
 * @return {Product}
 */
function buildHeadSignalsProduct(html, rendered, url) {
  const pair = pairOf(html, rendered, url);
  if (!pair) return notApplicable(NOT_COLLECTED);
  const differences = headDifferences(pair.raw, pair.rendered);
  // Google renders JavaScript, so a title or description set (or changed) by script is indexed as rendered: a note.
  // What is unreliable is a noindex that changes, or two different canonicals.
  const failing = differences.filter(
    d => d.field.startsWith('Robots') || (d.field === 'Canonical' && d.problem === 'differs')
  );
  const notes = differences.filter(d => !failing.includes(d));
  const headings = /** @type {Array<[string, string]>} */ ([
    ['field', 'Signal'],
    ['first', 'Raw HTML'],
    ['second', 'After JavaScript'],
    ['problem', 'Problem'],
  ]);
  const rows = [
    ...labelled('in the raw HTML', 'after JavaScript', failing),
    ...labelled('in the raw HTML', 'after JavaScript', notes).map(r => ({
      ...r,
      problem: `note: ${r.problem}; Google renders JavaScript, so this is normally indexed as rendered`,
    })),
  ];
  if (rows.length === 0) {
    return {score: 1, displayValue: 'Title, description, canonical and robots are the same'};
  }
  if (failing.length === 0) {
    return {
      score: 1,
      displayValue: `${notes.length} head ${
        notes.length === 1 ? 'signal is' : 'signals are'
      } set or changed by JavaScript (a note)`,
      details: table(rows, headings),
    };
  }
  return {
    score: 0,
    displayValue: `${failing.length} head ${
      failing.length === 1 ? 'signal differs' : 'signals differ'
    }`,
    explanation:
      'The canonical or noindex in the raw HTML is not the one the page has after JavaScript runs. Google may not apply a noindex or canonical that JavaScript changes, and a crawler that does not run JavaScript sees only the raw one. Put these in the server HTML.',
    details: table(rows, headings),
  };
}

/**
 * @param {unknown} html
 * @param {unknown} rendered
 * @param {string} url
 * @return {Product}
 */
function buildLinksProduct(html, rendered, url) {
  const pair = pairOf(html, rendered, url);
  if (!pair) return notApplicable(NOT_COLLECTED);
  const {raw, rendered: live} = pair;
  if (live.links.size === 0) return notApplicable('The rendered page has no internal links.');
  const onlyRendered = [...live.links].filter(l => !raw.links.has(l));
  const share = onlyRendered.length / live.links.size;
  const pct = Math.round(share * 100);
  if (onlyRendered.length === 0) {
    return {score: 1, displayValue: `All ${live.links.size} internal links are in the raw HTML`};
  }
  const fails = share > LINK_SHARE_FAIL && onlyRendered.length >= LINK_MIN_DIFFERENT;
  return {
    // A warning (0.5): Google follows rendered links; the risk is crawlers that do not run JavaScript.
    score: fails ? 0.5 : 1,
    displayValue: `${onlyRendered.length} of ${live.links.size} internal links (${pct}%) appear only after JavaScript`,
    explanation: fails
      ? `${pct}% of the page's internal links are missing from the raw HTML. A crawler that does not run JavaScript, or runs it late, will not follow them; make them real <a href> elements in the server HTML.`
      : `Some internal links appear only after JavaScript (${pct}%, under the ${Math.round(
          LINK_SHARE_FAIL * 100
        )}% limit).`,
    details: table(
      onlyRendered.map(l => ({url: clip(l)})),
      [['url', 'Internal link found only after JavaScript']]
    ),
  };
}

/**
 * @param {unknown} html
 * @param {unknown} rendered
 * @param {string} url
 * @return {Product}
 */
function buildContentProduct(html, rendered, url) {
  const pair = pairOf(html, rendered, url);
  if (!pair) return notApplicable(NOT_COLLECTED);
  const {raw, rendered: live} = pair;
  if (live.words < MIN_WORDS_TO_JUDGE) {
    return notApplicable(
      `The rendered page has under ${MIN_WORDS_TO_JUDGE} words, too little to compare.`
    );
  }
  const missing = 1 - Math.min(1, raw.words / live.words);
  const pct = Math.round(missing * 100);
  const fails = missing > WORD_SHARE_FAIL;
  /** @type {Array<Record<string, string>>} */
  const rows = [
    {what: 'Words in the raw HTML', value: String(raw.words)},
    {what: 'Words after JavaScript', value: String(live.words)},
    {what: 'Share that exists only after JavaScript', value: `${pct}%`},
  ];
  if (raw.h1.length === 0 && live.h1.length > 0) {
    rows.push({
      what: 'Main heading (h1)',
      value: `only after JavaScript: ${clip(live.h1[0], 100)}`,
    });
  }
  return {
    // A warning (0.5): Google renders JavaScript; the risk is crawlers and tools that do not.
    score: fails ? 0.5 : 1,
    displayValue: `${pct}% of the words appear only after JavaScript`,
    explanation: fails
      ? `More than half of the page's text (${pct}%) is missing from the raw HTML. A crawler that does not render JavaScript sees an almost empty page; serve the content in the HTML (server rendering or pre-rendering).`
      : undefined,
    details: table(rows, [
      ['what', 'Measure'],
      ['value', 'Value'],
    ]),
  };
}

/**
 * @param {unknown} html
 * @param {unknown} rendered
 * @param {string} url
 * @param {any} crawl The SiteCrawl artifact, or null.
 * @return {Product}
 */
function buildDiffProduct(html, rendered, url, crawl) {
  const pair = pairOf(html, rendered, url);
  if (!pair) return notApplicable(NOT_COLLECTED);
  const {raw, rendered: live} = pair;
  /**
   * @param {string} field
   * @param {string} a
   * @param {string} b
   * @return {Record<string, string>}
   */
  const row = (field, a, b) => ({
    field,
    raw: a || '(none)',
    rendered: b || '(none)',
    same: a === b ? 'same' : 'different',
  });
  const rows = [
    row('Title', clip(raw.title, 100), clip(live.title, 100)),
    row('Meta description', clip(raw.description, 100), clip(live.description, 100)),
    row('Canonical', clip(raw.canonical, 100), clip(live.canonical, 100)),
    row('Robots', raw.noindex ? 'noindex' : 'indexable', live.noindex ? 'noindex' : 'indexable'),
    row('First h1', clip(raw.h1[0] || '', 100), clip(live.h1[0] || '', 100)),
    row('Words', String(raw.words), String(live.words)),
    row('Internal links', String(raw.links.size), String(live.links.size)),
  ];
  const different = rows.filter(r => r.same === 'different').length;
  const notes = [];
  const audited =
    crawl && crawl.snapshot && Array.isArray(crawl.snapshot.pages)
      ? crawl.snapshot.pages.find(
          (/** @type {any} */ p) => p.source === 'audited' && p.extraction === 'ok'
        )
      : null;
  if (audited) {
    const odd = [];
    if (tidy(audited.title) !== raw.title) odd.push('title');
    if (audited.wordCount < raw.words * 0.5 || audited.wordCount > raw.words * 2) {
      odd.push('word count');
    }
    if (odd.length) {
      notes.push(
        `Note: the crawler's own copy of the page (its user-agent) differs from the HTML Chrome received in its ${odd.join(
          ' and '
        )}, so the server may answer bots differently.`
      );
    }
  }
  const items = [...rows, ...notes.map(n => ({field: n, raw: '', rendered: '', same: ''}))];
  return {
    score: 1,
    displayValue: `${different} of ${rows.length} measures differ after JavaScript`,
    details: table(items, [
      ['field', 'Measure'],
      ['raw', 'Raw HTML'],
      ['rendered', 'After JavaScript'],
      ['same', 'Result'],
    ]),
  };
}

/**
 * @param {unknown} html
 * @param {unknown} rendered
 * @param {string} url
 * @return {Product}
 */
function buildRenderingModeProduct(html, rendered, url) {
  const pair = pairOf(html, rendered, url);
  if (!pair) return notApplicable(NOT_COLLECTED);
  const {raw, rendered: live} = pair;
  const hints = FRAMEWORK_HINTS.filter(([pattern]) =>
    pattern.test(/** @type {string} */ (html).slice(0, 512 * 1024))
  ).map(([, name]) => name);
  if (live.words < MIN_WORDS_TO_CLASSIFY) {
    return {
      score: 1,
      displayValue: 'Too little text to classify',
      details: table(
        [{what: 'Words after JavaScript', value: String(live.words)}],
        [
          ['what', 'Measure'],
          ['value', 'Value'],
        ]
      ),
    };
  }
  const ratio = raw.words / live.words;
  const mode =
    ratio >= SERVER_RENDERED_RATIO
      ? 'server-rendered (the text is in the HTML)'
      : ratio < CLIENT_RENDERED_RATIO
      ? 'client-rendered (the text is built by JavaScript)'
      : 'hybrid (part of the text is in the HTML)';
  const rows = [
    {what: 'Looks', value: mode},
    {what: 'Words in the raw HTML', value: String(raw.words)},
    {what: 'Words after JavaScript', value: String(live.words)},
    {what: 'Framework signs in the HTML', value: hints.length ? hints.join(', ') : 'none found'},
  ];
  return {
    score: 1,
    displayValue: mode.split(' (')[0],
    details: table(rows, [
      ['what', 'Measure'],
      ['value', 'Value'],
    ]),
  };
}

/**
 * @param {any[] | null | undefined} messages ConsoleMessages
 * @return {Product}
 */
function buildHydrationProduct(messages) {
  if (!Array.isArray(messages)) return notApplicable('The console messages were not collected.');
  const seen = new Set();
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  for (const m of messages) {
    // Capped before the pattern runs: console text is chosen by the page, and the pattern is not linear on a
    // very long run of repeated words.
    const text = m && typeof m.text === 'string' ? m.text.slice(0, MAX_CONSOLE_CHARS) : '';
    if (!HYDRATION_ERROR.test(text)) continue;
    const key = text.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({message: clip(text, 300), level: String(m.level || '')});
  }
  if (rows.length === 0) return {score: 1, displayValue: 'No hydration errors in the console'};
  return {
    score: 0,
    displayValue: `${rows.length} hydration ${rows.length === 1 ? 'error' : 'errors'}`,
    explanation:
      'The browser logged that the HTML the server sent did not match what JavaScript built. After a hydration mismatch the page can lose or change content, so what a crawler read from the HTML may not be what users see.',
    details: table(rows, [
      ['message', 'Console message'],
      ['level', 'Level'],
    ]),
  };
}

/**
 * @param {any} artifact DeviceFetches
 * @return {Product}
 */
function buildDeviceParityProduct(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return notApplicable('The mobile and desktop fetches were not collected.');
  }
  if (artifact.state !== 'fetched') {
    return notApplicable(artifact.reason || 'The mobile and desktop fetches did not run.');
  }
  const {mobile, desktop} = artifact;
  /**
   * @param {any} f
   * @return {string | null} Why this fetch cannot be compared.
   */
  const problem = f =>
    !f
      ? 'was not fetched'
      : f.error
      ? `failed (${f.error})`
      : f.redirectLocation || (f.status >= 300 && f.status < 400)
      ? 'redirected'
      : f.status >= 400
      ? `answered ${f.status}`
      : f.bodyRead !== 'html'
      ? 'was not HTML'
      : null;
  const mobileProblem = problem(mobile);
  const desktopProblem = problem(desktop);
  if (mobileProblem || desktopProblem) {
    return notApplicable(
      `The ${
        mobileProblem ? `mobile fetch ${mobileProblem}` : `desktop fetch ${desktopProblem}`
      }, so the two cannot be compared.`
    );
  }
  const a = snapshotOf(desktop.html, artifact.url, desktop.truncated);
  const b = snapshotOf(mobile.html, artifact.url, mobile.truncated);
  if (!a || !b) return notApplicable('One of the two responses had no readable HTML.');

  const rows = labelled('on desktop', 'on mobile', headDifferences(a, b)).map(r => ({
    signal: r.field,
    desktop: r.first,
    mobile: r.second,
    problem: r.problem,
  }));
  let failed = rows.length > 0;
  const missingLinks = [...a.links].filter(l => !b.links.has(l));
  const linkShare = a.links.size ? missingLinks.length / a.links.size : 0;
  if (missingLinks.length > 0) {
    // A note, not a failure: a responsive site often has a smaller mobile menu on purpose.
    const big = linkShare > LINK_SHARE_FAIL && missingLinks.length >= LINK_MIN_DIFFERENT;
    rows.push({
      signal: 'Internal links',
      desktop: String(a.links.size),
      mobile: String(b.links.size),
      problem: `note: ${missingLinks.length} desktop links (${Math.round(
        linkShare * 100
      )}%) are missing on mobile${
        big ? ', which is common for a smaller mobile menu' : ' (under the limit)'
      }`,
    });
  }
  const wordShare = a.words >= MIN_WORDS_TO_JUDGE ? 1 - Math.min(1, b.words / a.words) : 0;
  if (wordShare > WORD_SHARE_FAIL) {
    failed = true;
    rows.push({
      signal: 'Words',
      desktop: String(a.words),
      mobile: String(b.words),
      problem: `mobile has ${Math.round(wordShare * 100)}% fewer words`,
    });
  }
  if (rows.length === 0) return {score: 1, displayValue: 'Mobile and desktop get the same page'};
  return {
    score: failed ? 0 : 1,
    displayValue: failed ? 'Mobile and desktop get a different page' : 'Small differences only',
    explanation: failed
      ? 'The server sent a mobile user-agent a different title, description, canonical or noindex, or much less text, than a desktop one. Google indexes the mobile version, so anything missing there can drop out of the index. This compares server HTML only; differences made by CSS or JavaScript between screen sizes are not seen.'
      : undefined,
    details: table(rows, [
      ['signal', 'Signal'],
      ['desktop', 'Desktop'],
      ['mobile', 'Mobile'],
      ['problem', 'Problem'],
    ]),
  };
}

export {
  snapshotOf,
  buildHeadSignalsProduct,
  buildLinksProduct,
  buildContentProduct,
  buildDiffProduct,
  buildRenderingModeProduct,
  buildHydrationProduct,
  buildDeviceParityProduct,
  MAX_ROWS,
  LINK_SHARE_FAIL,
  WORD_SHARE_FAIL,
};
