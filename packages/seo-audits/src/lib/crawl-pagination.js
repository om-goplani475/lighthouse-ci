/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builders for the pagination audits: `pagination-links` (do the page's `rel=next` and `rel=prev`
 * links work and agree?), `paginated-canonical` (does a paginated page canonicalise itself away?) and
 * `pagination-trap` (does a numbered series go on without end?). They read the site crawl's snapshot and the status
 * checks of the audited page's own links. No I/O, never throws.
 *
 * Rules, chosen with the developer:
 *   - pagination links fail when a target is broken, is the page itself, does not link back, or the `next` chain
 *     loops; a redirecting target is a note;
 *   - a paginated page fails when its canonical is another page of the same series (page 1 included): that hides
 *     pages 2 and on from indexing. A canonical outside the series (a view-all page) passes with a note;
 *   - a trap is evidence in the crawl itself: the audited page's path has more than `MAX_QUERY_VARIANTS` numbered
 *     variants known (requested, left out by the crawler's variant limit, or only pointed at by a `rel=next`) and the
 *     series was still going. No further request is made, so a very long but finite series looks the same, and a
 *     chain that only offers "next" is seen as far as the crawl's depth reaches (`LHCI_SEO_CRAWL_MAX_DEPTH`).
 * Google no longer uses `rel=next/prev`, so these are consistency checks, other search engines and tools still read them.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {normalizeUrl, MAX_QUERY_VARIANTS} from './crawl-snapshot.js';
import {buildLookup, outcomeFor} from './crawl-link-checks.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const MAX_CHAIN = 50;

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * @param {number} n
 * @param {string} noun
 * @return {string}
 */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {CrawlPage} page
 * @return {{next: string[], prev: string[]}}
 */
function signalsOf(page) {
  const p = page.pagination;
  return {
    next: p && Array.isArray(p.next) ? p.next : [],
    prev: p && Array.isArray(p.prev) ? p.prev : [],
  };
}

/** @type {WeakMap<CrawlPage, Set<string>>} */
const URL_SETS = new WeakMap();

/**
 * @param {CrawlPage} page
 * @return {Set<string>} Every URL the page is known by: requested and final (computed once per page).
 */
function urlsOf(page) {
  const known = URL_SETS.get(page);
  if (known) return known;
  /** @type {Set<string>} */
  const urls = new Set();
  for (const url of [normalizeUrl(page.url), normalizeUrl(page.finalUrl || page.url)]) {
    if (url) urls.add(url);
  }
  URL_SETS.set(page, urls);
  return urls;
}

/**
 * @param {CrawlPage[]} readable
 * @return {Map<string, CrawlPage>} Each readable page by every URL it is known by.
 */
function indexPages(readable) {
  /** @type {Map<string, CrawlPage>} */
  const index = new Map();
  for (const page of readable) {
    for (const url of urlsOf(page)) if (!index.has(url)) index.set(url, page);
  }
  return index;
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {{product: Product} | {
 *   snapshot: import('./crawl-snapshot.js').CrawlSnapshot, audited: CrawlPage, readable: CrawlPage[],
 *   index: Map<string, CrawlPage>, lookup: ReturnType<typeof buildLookup>,
 * }}
 */
function prepare(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return {product: notApplicable('The site crawl was not collected.')};
  }
  if (artifact.state === 'disabled' || artifact.state === 'unavailable') {
    return {product: notApplicable(artifact.reason || 'The site crawl did not run.')};
  }
  const snapshot = artifact.snapshot;
  if (!snapshot || !Array.isArray(snapshot.pages)) {
    return {product: notApplicable('The site crawl could not run.')};
  }
  const audited = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  if (!audited) {
    return {
      product: notApplicable(
        'The crawler did not receive the audited page as HTML, so its pagination links were not read.'
      ),
    };
  }
  const readable = snapshot.pages.filter(p => p.extraction === 'ok');
  return {
    snapshot,
    audited,
    readable,
    index: indexPages(readable),
    lookup: buildLookup(snapshot, artifact.linkChecks),
  };
}

/**
 * The readable crawled page at a URL, if the crawl read it.
 * @param {Map<string, CrawlPage>} index
 * @param {string} url
 * @return {CrawlPage | null}
 */
function pageAt(index, url) {
  const normal = normalizeUrl(url);
  return (normal && index.get(normal)) || null;
}

/** @typedef {{kind: 'next' | 'prev', target: string, fail: boolean, result: string, note: string}} LinkVerdict */

/**
 * @param {CrawlPage} page
 * @param {Map<string, CrawlPage>} index
 * @param {ReturnType<typeof buildLookup> | null} lookup Null when only crawled targets can be judged.
 * @param {string} origin
 * @return {LinkVerdict[]}
 */
function judgeLinks(page, index, lookup, origin) {
  /** @type {LinkVerdict[]} */
  const verdicts = [];
  const own = urlsOf(page);
  const signals = signalsOf(page);
  for (const kind of /** @type {const} */ (['next', 'prev'])) {
    for (const raw of signals[kind]) {
      const target = normalizeUrl(raw);
      if (!target) continue;
      /** @type {LinkVerdict} */
      const verdict = {kind, target, fail: false, result: 'ok', note: ''};
      verdicts.push(verdict);
      let sameOrigin = false;
      try {
        sameOrigin = new URL(target).origin === origin;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        verdict.result = 'other origin';
        verdict.note = 'not checked';
        continue;
      }
      if (own.has(target)) {
        verdict.fail = true;
        verdict.result = 'points to itself';
        continue;
      }
      const outcome = lookup ? outcomeFor(lookup, target) : null;
      const crawled = pageAt(index, target);
      if (outcome && (outcome.status === null || outcome.status >= 400)) {
        verdict.fail = true;
        verdict.result = outcome.status === null ? 'no answer' : `HTTP ${outcome.status}`;
        continue;
      }
      if (outcome && outcome.hops.length > 0) {
        verdict.note = `redirects to ${outcome.finalUrl}: link to the final URL`;
      }
      if (!crawled) {
        verdict.note =
          verdict.note ||
          (outcome ? 'not read by the crawl: links back not checked' : 'not checked');
        verdict.result = outcome ? 'ok' : 'not checked';
        continue;
      }
      const back = signalsOf(crawled)[kind === 'next' ? 'prev' : 'next'];
      const backs = new Set(back.map(url => normalizeUrl(url)).filter(Boolean));
      if (![...own].some(url => backs.has(url))) {
        verdict.fail = true;
        verdict.result = `does not link back with rel=${kind === 'next' ? 'prev' : 'next'}`;
      }
    }
  }
  return verdicts;
}

/**
 * @param {CrawlPage} start
 * @param {Map<string, CrawlPage>} index
 * @return {boolean} Whether following the first `next` of each page leads back to a page already visited.
 */
function nextChainLoops(start, index) {
  const seen = new Set(urlsOf(start));
  let current = start;
  for (let i = 0; i < MAX_CHAIN; i++) {
    const next = signalsOf(current).next[0];
    const page = next ? pageAt(index, next) : null;
    if (!page) return false;
    const urls = urlsOf(page);
    if ([...urls].some(url => seen.has(url))) return true;
    for (const url of urls) seen.add(url);
    current = page;
  }
  return false;
}

/** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
const LINK_HEADINGS = [
  {key: 'page', valueType: 'text', label: 'Page'},
  {key: 'link', valueType: 'text', label: 'Pagination link'},
  {key: 'result', valueType: 'text', label: 'Result'},
  {key: 'note', valueType: 'text', label: 'Note'},
];

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildPaginationLinksProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {snapshot, audited, readable, index, lookup} = prep;
  const signals = signalsOf(audited);
  if (signals.next.length === 0 && signals.prev.length === 0) {
    return notApplicable('The audited page declares no rel=next or rel=prev links.');
  }
  const verdicts = judgeLinks(audited, index, lookup, snapshot.origin);
  const loops = nextChainLoops(audited, index);
  const failing = verdicts.filter(v => v.fail);
  const problems = failing.length + (loops ? 1 : 0);

  /** @type {Array<Record<string, string>>} */
  const rows = verdicts.map(v => ({
    page: clip(audited.finalUrl || audited.url),
    link: clip(`rel=${v.kind}: ${v.target}`),
    result: v.result,
    note: v.note,
  }));
  if (loops) {
    rows.push({
      page: clip(audited.finalUrl || audited.url),
      link: 'rel=next chain',
      result: 'loops back to a page already visited',
      note: '',
    });
  }
  /** @type {Array<{page: CrawlPage, verdicts: LinkVerdict[]}>} */
  const others = [];
  for (const page of readable) {
    if (page === audited) continue;
    const found = judgeLinks(page, index, null, snapshot.origin).filter(v => v.fail);
    if (found.length) others.push({page, verdicts: found});
  }
  for (const {page, verdicts: found} of others.slice(0, MAX_ROWS)) {
    for (const v of found) {
      if (rows.length >= MAX_ROWS * 2) break;
      rows.push({
        page: clip(page.finalUrl || page.url),
        link: clip(`rel=${v.kind}: ${v.target}`),
        result: v.result,
        note: 'other crawled page, not judged',
      });
    }
  }
  const otherNote = others.length
    ? ` ${count(others.length, 'other crawled page')} also ${
        others.length === 1 ? 'has' : 'have'
      } pagination problems (listed, not judged).`
    : '';
  return {
    score: problems ? 0 : 1,
    displayValue: problems
      ? `${count(problems, 'problem')} with the rel=next/prev links`
      : `${count(verdicts.length, 'pagination link')} checked`,
    explanation: problems
      ? `The audited page's rel=next/rel=prev links are inconsistent: ${[
          ...failing.map(v => `rel=${v.kind} ${v.result}`),
          ...(loops ? ['the rel=next chain loops'] : []),
        ].join(
          '; '
        )}. Each page should link to its neighbours, and each neighbour back, ending at the first and last page.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(LINK_HEADINGS, rows),
  };
}

/**
 * The URLs that belong to the same numbered series as a page: everything joined to it by `rel=next` or
 * `rel=prev`, from the pages the crawl read.
 * @param {CrawlPage} start
 * @param {CrawlPage[]} readable
 * @return {Set<string>}
 */
function seriesOf(start, readable) {
  /** @type {Map<string, Set<string>>} */
  const adjacent = new Map();
  /** @param {string} a @param {string} b */
  const join = (a, b) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const set = adjacent.get(x) || new Set();
      set.add(y);
      adjacent.set(x, set);
    }
  };
  for (const page of readable) {
    const urls = [...urlsOf(page)];
    for (let i = 1; i < urls.length; i++) join(urls[0], urls[i]);
    const signals = signalsOf(page);
    for (const raw of [...signals.next, ...signals.prev]) {
      const target = normalizeUrl(raw);
      if (target && urls[0]) join(urls[0], target);
    }
  }
  const members = new Set(urlsOf(start));
  const queue = [...members];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacent.get(queue[i]) || []) {
      if (members.has(next)) continue;
      members.add(next);
      queue.push(next);
    }
  }
  return members;
}

/**
 * @param {CrawlPage} page
 * @return {string | null} The page's one canonical, absolute; null for none or several.
 */
function singleCanonical(page) {
  if (!Array.isArray(page.canonicals) || page.canonicals.length !== 1) return null;
  return normalizeUrl(page.canonicals[0], page.finalUrl || page.url);
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildPaginatedCanonicalProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {audited, readable} = prep;
  const members = seriesOf(audited, readable);
  const own = urlsOf(audited);
  const inSeries = [...members].some(url => !own.has(url));
  if (!inSeries) {
    return notApplicable('The audited page is not part of a rel=next / rel=prev series.');
  }
  if (Array.isArray(audited.canonicals) && audited.canonicals.length > 1) {
    return notApplicable(
      'The audited page declares several canonicals, which is a different problem (see canonical-conflicts).'
    );
  }
  const canonical = singleCanonical(audited);
  const away = canonical !== null && !own.has(canonical) && members.has(canonical);
  const outside = canonical !== null && !own.has(canonical) && !members.has(canonical);

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page in the series'},
    {key: 'canonical', valueType: 'text', label: 'Canonical'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  /** @type {Array<Record<string, string>>} */
  const rows = [
    {
      page: clip(audited.finalUrl || audited.url),
      canonical: canonical ? clip(canonical) : 'none declared',
      note: away
        ? 'the audited page: canonical is another page of the series'
        : outside
        ? 'the audited page: canonical is outside the series (a view-all page?)'
        : 'the audited page',
    },
  ];
  /** @type {CrawlPage[]} */
  const others = [];
  for (const page of readable) {
    if (page === audited || ![...urlsOf(page)].some(url => members.has(url))) continue;
    const target = singleCanonical(page);
    if (target && !urlsOf(page).has(target) && members.has(target)) others.push(page);
  }
  for (const page of others.slice(0, MAX_ROWS)) {
    rows.push({
      page: clip(page.finalUrl || page.url),
      canonical: clip(/** @type {string} */ (singleCanonical(page))),
      note: 'other page in the series: canonical is another page of the series, not judged',
    });
  }
  return {
    score: away ? 0 : 1,
    displayValue: away
      ? 'Canonical points at another page of the series'
      : outside
      ? 'Canonical points outside the series'
      : 'Canonical is the page itself (or absent)',
    explanation: away
      ? `The audited page is part of a paginated series and its canonical points at another page of it (${clip(
          /** @type {string} */ (canonical)
        )}). Search engines then treat the page as a duplicate of that one and may not index its items. Give each paginated page a canonical pointing at itself, or at a view-all page that holds everything.${
          others.length
            ? ` ${count(
                others.length,
                'other page'
              )} of the series do the same (listed, not judged).`
            : ''
        }`
      : undefined,
    details: Audit.makeTableDetails(headings, rows),
  };
}

/**
 * @param {string} url
 * @return {{origin: string, path: string, search: string} | null}
 */
function splitUrl(url) {
  try {
    const u = new URL(url);
    return {origin: u.origin, path: u.pathname, search: u.search};
  } catch {
    return null;
  }
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildPaginationTrapProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {audited} = prep;
  const snapshot = prep.snapshot;
  const where = splitUrl(audited.finalUrl || audited.url);
  const signals = signalsOf(audited);
  const paginated = signals.next.length > 0 || signals.prev.length > 0;
  if (!where || (!where.search && !paginated)) {
    return notApplicable(
      'The audited page has no query string and no rel=next or rel=prev links, so it is not part of a numbered series.'
    );
  }
  // Every numbered variant of this path the crawl knows of: requested, left out by the variant limit, or only
  // pointed at by a rel=next / rel=prev of a variant it did read.
  /** @type {Set<string>} */
  const crawled = new Set();
  /** @type {Set<string>} */
  const pointedAt = new Set();
  let nextSeen = signals.next.length > 0;
  /** @param {string} url @return {string | null} The query string, when the URL is a variant of this path. */
  const variantOf = url => {
    const at = splitUrl(url);
    return at && at.origin === where.origin && at.path === where.path && at.search
      ? at.search
      : null;
  };
  for (const page of snapshot.pages) {
    const at = splitUrl(page.finalUrl || page.url);
    if (!at || at.origin !== where.origin || at.path !== where.path) continue;
    if (at.search) crawled.add(at.search);
    const found = signalsOf(page);
    if (found.next.length > 0) nextSeen = true;
    for (const raw of [...found.next, ...found.prev]) {
      const search = variantOf(raw);
      if (search) pointedAt.add(search);
    }
  }
  let skippedVariants = 0;
  const left = new Set();
  for (const skip of snapshot.skipped) {
    if (skip.reason !== 'query-variants') continue;
    const at = splitUrl(skip.url);
    if (at && at.origin === where.origin && at.path === where.path) {
      skippedVariants++;
      if (at.search) left.add(at.search);
    }
  }
  const unfollowed = [...pointedAt].filter(search => !crawled.has(search)).length;
  const variants = new Set([...crawled, ...left, ...pointedAt]);
  const stillGoing = skippedVariants > 0 || unfollowed > 0;
  const trap = variants.size > MAX_QUERY_VARIANTS && nextSeen && stillGoing;
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'path', valueType: 'text', label: 'Path'},
    {key: 'variants', valueType: 'text', label: 'Query-string variants seen'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  const rows = [
    {
      path: clip(`${where.origin}${where.path}`),
      variants: variants.size,
      note: trap
        ? `the crawl followed ${count(crawled.size, 'variant')} and the series was still going`
        : stillGoing && !nextSeen
        ? 'more variants were found, but no rel=next points forward'
        : stillGoing
        ? `${count(
            left.size + unfollowed,
            'more variant'
          )} known but not followed: too few to call it a trap`
        : 'the series ended inside what the crawl followed',
    },
  ];
  return {
    score: trap ? 0 : 1,
    displayValue: trap
      ? `At least ${variants.size} numbered variants, still going`
      : `${count(variants.size, 'variant')} of this path seen`,
    explanation: trap
      ? `The audited page's path has at least ${
          variants.size
        } query-string variants and the series was still going when the crawl stopped following it (at most ${MAX_QUERY_VARIANTS} variants of a path are requested, and links are followed only ${
          snapshot.bounds && snapshot.bounds.depth ? snapshot.bounds.depth : 3
        } hops), so it looks endless or very long. Crawlers can spend their whole budget walking it. Cap the series, make the last page stop linking forward, or noindex deep pages. A long but finite series looks the same from here.`
      : undefined,
    details: Audit.makeTableDetails(headings, rows),
  };
}

export {
  buildPaginationLinksProduct,
  buildPaginatedCanonicalProduct,
  buildPaginationTrapProduct,
  seriesOf,
  MAX_ROWS,
};
