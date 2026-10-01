/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the `canonical-conflicts` audit: do the canonicals declared by the crawled
 * pages contradict each other or the pages they point at? Reads the site crawl's snapshot only (no
 * request). No I/O, never throws.
 *
 * Conflicts found, chosen with the developer:
 *   - chain: a page's canonical target declares a canonical to a third URL;
 *   - loop: canonicals that lead back to the page they started from;
 *   - bad target: the target is an error page, redirects, is noindex, or robots.txt blocked it from the crawl;
 *   - mixed target: several pages with different content declare the same canonical target.
 *
 * Judging: Phase 6's `indexability-conflicts` already checks the audited page's *own* canonical target, so
 * that is not repeated. The audit fails when the audited page is on the receiving end of a conflict (another
 * page's canonical points at it and it is a chain, loop, error, redirect or noindex, or it is the shared
 * target of pages with different content). Conflicts among the other crawled pages are listed, not judged.
 *
 * Only pages with a single `<link rel=canonical>` take part as sources: several on one page is a
 * different problem, and the page's own canonical is not a conflict when it points at itself.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {normalizeUrl} from './crawl-snapshot.js';
import {noindexFor} from './robots-directives.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {'loop' | 'chain' | 'error' | 'redirect' | 'noindex' | 'blocked' | 'mixed'} ConflictKind */
/** @typedef {{kind: ConflictKind, source: string, target: string, involvesAudited: boolean}} Conflict */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const MAX_HOPS = 10;
const KIND_TEXT = {
  loop: 'canonicals lead in a circle',
  chain: 'target declares another canonical (a chain)',
  error: 'target is an error page',
  redirect: 'target redirects',
  noindex: 'target is noindex',
  blocked: 'target is blocked by robots.txt',
  mixed: 'pages with different content share this canonical target',
};

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * The page's one canonical as a comparable absolute URL; null when it has none, several, an unusable
 * one, or one that is the page itself.
 * @param {CrawlPage} page
 * @return {string | null}
 */
function canonicalOf(page) {
  if (page.extraction !== 'ok' || !Array.isArray(page.canonicals) || page.canonicals.length !== 1) {
    return null;
  }
  const target = normalizeUrl(page.canonicals[0], page.finalUrl || page.url);
  if (!target) return null;
  const self = normalizeUrl(page.finalUrl || page.url);
  return target === self ? null : target;
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildCanonicalConflictsProduct(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return {score: 1, notApplicable: true, explanation: 'The site crawl was not collected.'};
  }
  if (artifact.state === 'disabled' || artifact.state === 'unavailable') {
    return {
      score: 1,
      notApplicable: true,
      explanation: artifact.reason || 'The site crawl did not run.',
    };
  }
  const snapshot = artifact.snapshot;
  if (!snapshot || !Array.isArray(snapshot.pages)) {
    return {score: 1, notApplicable: true, explanation: 'The site crawl could not run.'};
  }
  const auditedPage = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  if (!auditedPage) {
    return {
      score: 1,
      notApplicable: true,
      explanation:
        'The crawler did not receive the audited page as HTML, so canonicals were not compared.',
    };
  }
  const readable = snapshot.pages.filter(p => p.extraction === 'ok');
  if (readable.length < 2) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'The crawl reached no other page to compare canonicals with.',
    };
  }

  // A canonical target may be written as the URL that was requested or as where it ended up.
  /** @type {Map<string, CrawlPage>} */
  const byFinal = new Map();
  /** @type {Map<string, CrawlPage>} */
  const byRequested = new Map();
  for (const page of snapshot.pages) {
    const final = normalizeUrl(page.finalUrl || page.url);
    const requested = normalizeUrl(page.url);
    if (final && !byFinal.has(final)) byFinal.set(final, page);
    if (requested && !byRequested.has(requested)) byRequested.set(requested, page);
  }
  const blockedUrls = new Set(
    (snapshot.skipped || [])
      .filter(s => s.reason === 'blocked-by-robots')
      .map(s => normalizeUrl(s.url))
  );
  const auditedUrls = new Set(
    [normalizeUrl(auditedPage.url), normalizeUrl(auditedPage.finalUrl || auditedPage.url)].filter(
      Boolean
    )
  );
  /** @param {string} url */
  const isAudited = url => auditedUrls.has(url);

  /** @type {Conflict[]} */
  const conflicts = [];
  /**
   * @param {ConflictKind} kind
   * @param {CrawlPage} source
   * @param {string} target
   * @param {boolean} involvesAudited
   */
  const add = (kind, source, target, involvesAudited) => {
    conflicts.push({kind, source: source.finalUrl || source.url, target, involvesAudited});
  };

  const inLoop = new Set();
  /** @type {Map<string, CrawlPage[]>} */
  const pointing = new Map();
  for (const page of readable) {
    const target = canonicalOf(page);
    if (!target) continue;
    const sourceIsAudited = page === auditedPage;
    const targetPage = byFinal.get(target) || byRequested.get(target) || null;

    // The audited page's own target is Phase 6's job; its conflicts are not repeated here.
    const judged = !sourceIsAudited;
    const involvesAudited = isAudited(target);

    if (!sourceIsAudited) {
      const list = pointing.get(target) || [];
      list.push(page);
      pointing.set(target, list);
    }

    // Walk the chain from this page; a return to the start is a loop, any further canonical a chain.
    const startKeys = new Set(
      [normalizeUrl(page.url), normalizeUrl(page.finalUrl || page.url)].filter(Boolean)
    );
    let loopTouchesAudited = false;
    let looped = false;
    let hops = 0;
    /** @type {string | null} */
    let next = target;
    const visited = new Set();
    while (next && hops < MAX_HOPS) {
      if (startKeys.has(next)) {
        looped = true;
        break;
      }
      if (visited.has(next)) break;
      visited.add(next);
      if (isAudited(next)) loopTouchesAudited = true;
      /** @type {CrawlPage | undefined} */
      const nextPage = byFinal.get(next) || byRequested.get(next);
      next = nextPage ? canonicalOf(nextPage) : null;
      hops++;
    }
    if (looped) {
      // One row per circle, not one per page in it.
      const members = [...startKeys, ...visited];
      if (judged && !members.some(m => inLoop.has(m))) {
        add('loop', page, target, loopTouchesAudited);
        for (const m of members) inLoop.add(m);
      }
      continue;
    }
    if (!judged || !targetPage) continue;
    const redirected =
      !byFinal.has(target) &&
      byRequested.has(target) &&
      normalizeUrl(targetPage.url) !== normalizeUrl(targetPage.finalUrl || targetPage.url);
    if (redirected) {
      add('redirect', page, target, involvesAudited);
    } else if (
      targetPage.extraction === 'error' ||
      targetPage.status === null ||
      targetPage.status >= 400
    ) {
      add('error', page, target, involvesAudited);
    } else if (targetPage.extraction === 'ok') {
      if (canonicalOf(targetPage)) {
        add('chain', page, target, involvesAudited);
      } else if (
        noindexFor(['googlebot', 'bingbot'], {
          metas: targetPage.robotsMetas || [],
          xRobotsTag: targetPage.xRobotsTag || [],
        }).length
      ) {
        add('noindex', page, target, involvesAudited);
      }
    }
  }
  // A target that robots.txt kept the crawler out of has no page to look up.
  for (const [target, sources] of pointing) {
    if (!byFinal.has(target) && !byRequested.has(target) && blockedUrls.has(target)) {
      for (const page of sources) add('blocked', page, target, isAudited(target));
    }
  }
  // Pages with different content that share one canonical target.
  for (const [target, sources] of pointing) {
    const hashes = new Set(sources.filter(p => p.textHash).map(p => p.textHash));
    if (sources.length >= 2 && hashes.size >= 2) {
      add('mixed', sources[0], target, isAudited(target));
    }
  }

  const failing = conflicts.filter(c => c.involvesAudited);
  const others = conflicts.filter(c => !c.involvesAudited);
  if (conflicts.length === 0) {
    return {
      score: 1,
      displayValue: `No conflicts among ${readable.length} crawled pages`,
    };
  }

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page'},
    {key: 'target', valueType: 'text', label: 'Canonical target'},
    {key: 'problem', valueType: 'text', label: 'Problem'},
    {key: 'audited', valueType: 'text', label: 'Involves the audited page'},
  ];
  const ordered = [...failing, ...others];
  const shown = ordered.slice(0, MAX_ROWS);
  const items = shown.map(c => ({
    page: clip(c.kind === 'mixed' ? 'several pages' : c.source),
    target: clip(c.target),
    problem: KIND_TEXT[c.kind],
    audited: c.involvesAudited ? 'yes' : '',
  }));
  if (ordered.length > shown.length) {
    items.push({
      page: `${ordered.length - shown.length} more not shown`,
      target: '',
      problem: '',
      audited: '',
    });
  }
  const otherNote = others.length
    ? ` ${others.length} more ${
        others.length === 1 ? 'conflict' : 'conflicts'
      } among other crawled pages ${others.length === 1 ? 'is' : 'are'} listed, not judged.`
    : '';
  return {
    score: failing.length ? 0 : 1,
    displayValue: failing.length
      ? `${failing.length} ${
          failing.length === 1 ? 'conflict involves' : 'conflicts involve'
        } the audited page`
      : `${others.length} ${others.length === 1 ? 'conflict' : 'conflicts'} on other pages`,
    explanation: failing.length
      ? `Other crawled pages declare canonicals that point at the audited page, and the audited page is a bad target for them (see the table). Make every canonical point at a final, indexable page that is its own canonical.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(headings, items),
  };
}

export {buildCanonicalConflictsProduct, canonicalOf, MAX_ROWS};
