/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builders for the three internal link-check audits: `broken-internal-links`,
 * `redirecting-internal-links` and `internal-redirect-chains`. They read the site crawl's snapshot and the
 * status checks of the audited page's own links (`linkChecks`): no request, no I/O, never throws.
 *
 * Rules, chosen with the developer:
 *   - every link on every crawled page is judged, not only the audited page's (a broken link on another crawled
 *     page fails the run, and the audited page's rows come first);
 *   - broken: the target answered 4xx or 5xx, or did not answer at all; except 401, 403 and 429, which usually mean
 *     bot protection or a rate limit rather than a dead link, so they are counted and not judged;
 *   - redirecting: the target redirects exactly once; only a permanent redirect (301 or 308) fails, a temporary
 *     one (302, 303, 307) is listed with a note;
 *   - chain: the target redirects two or more times, or in a circle: fails whatever the statuses.
 * A link whose target the crawl neither read nor checked is not judged; the audits say how many links that is.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {normalizeUrl} from './crawl-snapshot.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('./crawl-snapshot.js').CrawlHop} CrawlHop */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/**
 * @typedef {{
 *   source: string, sourceIsAudited: boolean, target: string, finalUrl: string, status: number | null,
 *   hops: CrawlHop[],
 * }} LinkOutcome
 */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const PERMANENT = new Set([301, 308]);
const NOT_JUDGED = new Set([401, 403, 429]);

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
 * @param {CrawlHop[]} hops
 * @return {boolean} Whether the redirects lead back to a URL already seen.
 */
function isLoop(hops) {
  if (hops.length === 0) return false;
  const seen = new Set([normalizeUrl(hops[0].url) || hops[0].url]);
  for (const hop of hops) {
    if (!hop.location) continue;
    const to = normalizeUrl(hop.location) || hop.location;
    if (seen.has(to)) return true;
    seen.add(to);
  }
  return false;
}

/**
 * What the crawl and the status checks know about each URL: its status, where it ends up and every redirect hop.
 * @param {import('./crawl-snapshot.js').CrawlSnapshot} snapshot
 * @param {SiteCrawlArtifact['linkChecks'] | undefined} linkChecks
 */
function buildLookup(snapshot, linkChecks) {
  /** @type {Map<string, CrawlPage>} */
  const byRequested = new Map();
  /** @type {Map<string, CrawlPage>} */
  const byFinal = new Map();
  for (const page of snapshot.pages) {
    const requested = normalizeUrl(page.url);
    const final = normalizeUrl(page.finalUrl || page.url);
    if (requested && !byRequested.has(requested)) byRequested.set(requested, page);
    if (final && !byFinal.has(final)) byFinal.set(final, page);
  }
  /** @type {Map<string, {status: number | null, finalUrl: string, hops: CrawlHop[]}>} */
  const checks = new Map();
  if (linkChecks && Array.isArray(linkChecks.checked)) {
    for (const check of linkChecks.checked) {
      const url = normalizeUrl(check.url);
      if (url && check.state === 'checked') {
        checks.set(url, {
          status: check.status,
          finalUrl: check.finalUrl,
          hops: check.redirects || [],
        });
      }
    }
  }

  /**
   * The crawler stops following a redirect whose destination it already requested, so an entry can end on a
   * 3xx: carry on through the pages it already holds to the real end (status, final URL, and every hop).
   * @param {number | null} status
   * @param {string} finalUrl
   * @param {CrawlHop[]} firstHops
   * @return {{status: number | null, finalUrl: string, hops: CrawlHop[]}}
   */
  const resolveEnd = (status, finalUrl, firstHops) => {
    let hops = firstHops;
    for (
      let i = 0;
      i < 5 && status !== null && status >= 300 && status < 400 && hops.length > 0;
      i++
    ) {
      const last = hops[hops.length - 1];
      const to = last.location ? normalizeUrl(last.location) : null;
      const next = to ? byRequested.get(to) || byFinal.get(to) : undefined;
      if (!to || !next) {
        if (to) finalUrl = to;
        break;
      }
      status = next.extraction === 'error' ? null : next.status;
      finalUrl = next.finalUrl || next.url;
      const more = byRequested.get(to) === next ? next.redirects || [] : [];
      const loops = more.some(h => hops.some(x => x.url === h.url));
      hops = [...hops, ...more];
      if (loops) break;
    }
    return {status, finalUrl, hops};
  };

  return {byRequested, byFinal, checks, resolveEnd};
}

/**
 * The outcome for one URL: from the crawl when it was read (the page requested at that URL, or the page it ends
 * on), else from the audited page's own status checks; null when neither knows it.
 * @param {ReturnType<typeof buildLookup>} lookup
 * @param {string} rawUrl
 * @return {{status: number | null, finalUrl: string, hops: CrawlHop[]} | null}
 */
function outcomeFor(lookup, rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  const crawled = lookup.byRequested.get(url) || lookup.byFinal.get(url);
  if (crawled) {
    const direct = lookup.byRequested.get(url) === crawled;
    return lookup.resolveEnd(
      crawled.extraction === 'error' ? null : crawled.status,
      crawled.finalUrl || crawled.url,
      direct ? crawled.redirects || [] : []
    );
  }
  return lookup.checks.get(url) || null;
}

/**
 * Every internal link with an outcome we know: from the pages the crawl read, and for the audited page also
 * from the status checks of its own links.
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {{product: Product} | {outcomes: LinkOutcome[], total: number, known: number}}
 */
function collectOutcomes(artifact) {
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

  const {byRequested, byFinal, checks, resolveEnd} = buildLookup(snapshot, artifact.linkChecks);

  /** @type {LinkOutcome[]} */
  const outcomes = [];
  const targets = new Set();
  const known = new Set();
  for (const source of snapshot.pages) {
    if (source.extraction !== 'ok') continue;
    const sourceUrl = source.finalUrl || source.url;
    const seenHere = new Set();
    for (const link of source.links) {
      const url = normalizeUrl(link.url);
      if (!url || seenHere.has(url)) continue;
      seenHere.add(url);
      targets.add(url);
      const crawled = byRequested.get(url) || byFinal.get(url);
      const checked = source.source === 'audited' ? checks.get(url) : undefined;
      let result = null;
      if (crawled) {
        const direct = byRequested.get(url) === crawled;
        result = resolveEnd(
          crawled.extraction === 'error' ? null : crawled.status,
          crawled.finalUrl || crawled.url,
          direct ? crawled.redirects || [] : []
        );
      } else if (checked) {
        result = checked;
      }
      if (!result) continue;
      known.add(url);
      outcomes.push({
        source: sourceUrl,
        sourceIsAudited: source.source === 'audited',
        target: url,
        ...result,
      });
    }
  }
  // The audited page's rendered links (and any the server HTML lacks) that were status-checked.
  const auditedPage = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  if (auditedPage) {
    const sourceUrl = auditedPage.finalUrl || auditedPage.url;
    for (const [url, check] of checks) {
      if (known.has(url)) continue;
      targets.add(url);
      known.add(url);
      outcomes.push({source: sourceUrl, sourceIsAudited: true, target: url, ...check});
    }
  }
  if (targets.size === 0) {
    return {product: notApplicable('No internal links were found on the pages the crawl read.')};
  }
  return {outcomes, total: targets.size, known: known.size};
}

/**
 * @param {LinkOutcome[]} problems
 * @param {(o: LinkOutcome) => string} result
 * @param {(o: LinkOutcome) => string} note
 * @return {Array<Record<string, string>>}
 */
function rowsFor(problems, result, note) {
  const ordered = [...problems].sort(
    (a, b) => Number(b.sourceIsAudited) - Number(a.sourceIsAudited)
  );
  const shown = ordered.slice(0, MAX_ROWS).map(o => ({
    page: clip(o.source),
    target: clip(o.target),
    result: result(o),
    note: note(o),
  }));
  if (ordered.length > shown.length) {
    shown.push({
      page: `${ordered.length - shown.length} more not shown`,
      target: '',
      result: '',
      note: '',
    });
  }
  return shown;
}

/** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
const HEADINGS = [
  {key: 'page', valueType: 'text', label: 'Link on page'},
  {key: 'target', valueType: 'text', label: 'Links to'},
  {key: 'result', valueType: 'text', label: 'Result'},
  {key: 'note', valueType: 'text', label: 'Note'},
];

/**
 * @param {{total: number, known: number}} coverage
 * @return {string}
 */
function coverageText({total, known}) {
  return known === total
    ? `all ${count(total, 'distinct link target')} checked`
    : `${known} of ${count(
        total,
        'distinct link target'
      )} checked, the rest were not reached by the crawl`;
}

/**
 * @param {LinkOutcome} o
 * @return {string}
 */
function statusText(o) {
  return o.status === null ? 'no answer' : `HTTP ${o.status}`;
}

/**
 * @param {LinkOutcome[]} problems
 * @return {string}
 */
function pagesText(problems) {
  return count(new Set(problems.map(o => o.source)).size, 'page');
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildBrokenLinksProduct(artifact) {
  const collected = collectOutcomes(artifact);
  if ('product' in collected) return collected.product;
  const failing = collected.outcomes.filter(o => o.status === null || o.status >= 400);
  const broken = failing.filter(o => !NOT_JUDGED.has(Number(o.status)));
  const blocked = failing.length - broken.length;
  const coverage =
    coverageText(collected) +
    (blocked
      ? `; ${count(blocked, 'link')} answered 401, 403 or 429 (often bot protection) and ${
          blocked === 1 ? 'was' : 'were'
        } not judged`
      : '');
  if (broken.length === 0) {
    return {score: 1, displayValue: `No broken links (${coverage})`};
  }
  return {
    score: 0,
    displayValue: `${count(broken.length, 'broken link')} on ${pagesText(broken)}`,
    explanation: `${count(
      broken.length,
      'internal link'
    )} point at a page that answers with an error or does not answer (${coverage}). Fix or remove each link: visitors hit a dead end and crawlers waste their time.`,
    details: Audit.makeTableDetails(
      HEADINGS,
      rowsFor(broken, statusText, o =>
        o.hops.length ? `after ${count(o.hops.length, 'redirect')}` : ''
      )
    ),
  };
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildRedirectingLinksProduct(artifact) {
  const collected = collectOutcomes(artifact);
  if ('product' in collected) return collected.product;
  const once = collected.outcomes.filter(o => o.hops.length === 1 && !isLoop(o.hops));
  const permanent = once.filter(o => PERMANENT.has(o.hops[0].status));
  const temporary = once.filter(o => !PERMANENT.has(o.hops[0].status));
  const coverage = coverageText(collected);
  if (once.length === 0) {
    return {score: 1, displayValue: `No redirecting links (${coverage})`};
  }
  const rows = rowsFor(
    [...permanent, ...temporary],
    o => `${o.hops[0].status} to ${o.finalUrl}`,
    o =>
      PERMANENT.has(o.hops[0].status)
        ? 'permanent redirect: link to the final URL'
        : 'temporary redirect, not failing'
  );
  return {
    score: permanent.length ? 0 : 1,
    displayValue: permanent.length
      ? `${count(permanent.length, 'link')} to a permanent redirect on ${pagesText(permanent)}`
      : `${count(temporary.length, 'temporary redirect')} (not failing)`,
    explanation: permanent.length
      ? `${count(
          permanent.length,
          'internal link'
        )} point at a URL that permanently redirects (${coverage}). Link to the final URL instead: it saves a request on every visit and passes more of the link's value.${
          temporary.length
            ? ` ${count(temporary.length, 'link')} to a temporary redirect ${
                temporary.length === 1 ? 'is' : 'are'
              } also listed, not judged.`
            : ''
        }`
      : undefined,
    details: Audit.makeTableDetails(HEADINGS, rows),
  };
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildRedirectChainsProduct(artifact) {
  const collected = collectOutcomes(artifact);
  if ('product' in collected) return collected.product;
  const chains = collected.outcomes.filter(o => o.hops.length >= 2 || isLoop(o.hops));
  const coverage = coverageText(collected);
  if (chains.length === 0) {
    return {score: 1, displayValue: `No redirect chains (${coverage})`};
  }
  const loops = chains.filter(o => isLoop(o.hops));
  return {
    score: 0,
    displayValue: `${count(chains.length, 'link')} through a redirect chain or loop on ${pagesText(
      chains
    )}`,
    explanation: `${count(
      chains.length,
      'internal link'
    )} point at a URL that redirects more than once${
      loops.length ? `, ${count(loops.length, 'of them')} in a circle that never ends` : ''
    } (${coverage}). Link to the final URL: every extra hop slows the visit, and crawlers give up after a few.`,
    details: Audit.makeTableDetails(
      HEADINGS,
      rowsFor(
        chains,
        o =>
          isLoop(o.hops)
            ? `loop after ${count(o.hops.length, 'hop')}`
            : `${count(o.hops.length, 'hop')} to ${o.finalUrl}`,
        o => o.hops.map(hop => hop.status).join(' > ')
      )
    ),
  };
}

export {
  buildBrokenLinksProduct,
  buildRedirectingLinksProduct,
  buildRedirectChainsProduct,
  collectOutcomes,
  buildLookup,
  outcomeFor,
  isLoop,
  MAX_ROWS,
};
