/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure logic for the indexability audits: no I/O. One decision tree over the signals a search engine
 * weighs for a single page (HTTP status, robots.txt, meta robots and `X-Robots-Tag`, canonical, and
 * whether there is any text to index), used twice:
 *
 * - `indexabilityVerdict`: informative. Says in plain English whether the page can be indexed and why.
 *   A deliberate `noindex` is legitimate, so the verdict never fails.
 * - `indexabilityConflicts`: scored. Fails only when signals contradict each other, which is never
 *   intentional: `noindex` that robots.txt stops a crawler from ever seeing, `noindex` together with a
 *   canonical to another URL, a canonical that robots.txt stops a crawler from reading, a canonical on an
 *   error page, and a canonical whose target is itself broken.
 *
 * Not repeated here, because other audits own them: meta-vs-header disagreement
 * (`robots-directives-conflict`) and a listed sitemap URL that is noindex (`sitemap-indexability`).
 */

import robotsParser from 'robots-parser';
import {Audit} from 'lighthouse/core/audits/audit.js';
import {CRAWLERS} from './robots-access.js';
import {noindexFor} from './robots-directives.js';
import {robotsTxtState} from './robots-txt.js';

/**
 * @typedef {import('./sitemap-parse.js').SampledPage} SampledPage
 * @typedef {import('./robots-txt.js').RobotsTxtArtifact} RobotsTxtArtifact
 * @typedef {'googlebot' | 'bingbot'} CrawlerKey
 * @typedef {{
 *   pageUrl: string,
 *   status: number | null,
 *   robotsTxt: RobotsTxtArtifact | null,
 *   metas: Array<{name: string, content: string}>,
 *   xRobotsTag: string[],
 *   canonicals: string[],
 *   target: SampledPage | null,
 *   bodyTextLength: number | null,
 * }} IndexabilityInput
 * @typedef {{kind: 'none' | 'self' | 'trailing-slash' | 'conflicting' | 'elsewhere', target?: string}} CanonicalClass
 * @typedef {{state: 'present' | 'absent' | 'unavailable', blocked: CrawlerKey[]}} RobotsAccess
 * @typedef {import('lighthouse/types/audit.js').default.Product} Product
 */

const CRAWLER_KEYS = /** @type {CrawlerKey[]} */ (['googlebot', 'bingbot']);
const CRAWLER_LABEL = {googlebot: 'Googlebot', bingbot: 'Bingbot'};
const MIN_TEXT_CHARS = 100;
const MAX_TEXT_CHARS = 1_000;

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_TEXT_CHARS)}... (${text.length - MAX_TEXT_CHARS} more characters)`;
}

/**
 * @param {URL} url
 * @return {string}
 */
function withoutFragment(url) {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

/**
 * @param {string} href
 * @return {string}
 */
function withoutTrailingSlash(href) {
  const url = new URL(href);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

/**
 * Classifies a page's canonical(s) relative to the page's own URL (the same rules as
 * `sitemap-indexability`: a fragment is ignored, and a difference of only a trailing slash is not
 * "elsewhere").
 * @param {string} pageUrl
 * @param {string[]} hrefs
 * @return {CanonicalClass}
 */
function classifyCanonical(pageUrl, hrefs) {
  /** @type {Set<string>} */
  const resolved = new Set();
  for (const href of hrefs) {
    try {
      resolved.add(withoutFragment(new URL(href, pageUrl)));
    } catch {
      // An href that cannot be resolved is not a usable canonical.
    }
  }
  if (resolved.size === 0) return {kind: 'none'};
  if (resolved.size > 1) return {kind: 'conflicting'};
  const target = [...resolved][0];
  const self = withoutFragment(new URL(pageUrl));
  if (target === self) return {kind: 'self'};
  if (withoutTrailingSlash(target) === withoutTrailingSlash(self)) {
    return {kind: 'trailing-slash', target};
  }
  return {kind: 'elsewhere', target};
}

/**
 * Which of the scored search crawlers robots.txt stops from fetching a URL.
 * @param {RobotsTxtArtifact | null} robotsTxt
 * @param {string} url
 * @return {RobotsAccess}
 */
function robotsAccess(robotsTxt, url) {
  if (!robotsTxt) return {state: 'unavailable', blocked: []};
  const state = robotsTxtState(robotsTxt);
  if (state !== 'present') return {state, blocked: []};
  const robots = robotsParser(
    new URL('/robots.txt', url).href,
    /** @type {string} */ (robotsTxt.content)
  );
  const blocked = CRAWLER_KEYS.filter(key => {
    const name = CRAWLERS.find(c => c.name.toLowerCase() === key)?.name || key;
    return robots.isAllowed(url, name) === false;
  });
  return {state, blocked};
}

/**
 * @param {CrawlerKey[]} keys
 * @return {string}
 */
function crawlerNames(keys) {
  return keys.map(k => CRAWLER_LABEL[k]).join(' and ');
}

/**
 * @param {IndexabilityInput} input
 * @return {{
 *   status: number | null,
 *   robots: RobotsAccess,
 *   noindex: Array<{crawler: CrawlerKey, via: string[]}>,
 *   canonical: CanonicalClass,
 *   canonicalCount: number,
 *   target: {page: SampledPage, problems: string[], notes: string[]} | null,
 * }}
 */
function analyze(input) {
  const robots = robotsAccess(input.robotsTxt, input.pageUrl);
  const noindex = noindexFor(CRAWLER_KEYS, {metas: input.metas, xRobotsTag: input.xRobotsTag});
  const canonical = classifyCanonical(input.pageUrl, input.canonicals);

  /** @type {{page: SampledPage, problems: string[], notes: string[]} | null} */
  let target = null;
  if (input.target && canonical.kind === 'elsewhere') {
    const page = input.target;
    /** @type {string[]} */
    const problems = [];
    /** @type {string[]} */
    const notes = [];
    if (page.error || page.notChecked || page.status === null) {
      notes.push(
        page.error
          ? `the canonical target could not be requested (${clip(page.error)})`
          : 'the canonical target was not checked'
      );
    } else if (page.status >= 300 && page.status < 400) {
      problems.push(
        `the canonical target redirects (HTTP ${page.status}${
          page.redirectLocation ? ` to ${clip(page.redirectLocation)}` : ''
        }), so it is not the final URL`
      );
    } else if (page.status === 404 || page.status === 410) {
      problems.push(`the canonical target returns HTTP ${page.status}`);
    } else if (page.status >= 400) {
      // 401, 403, 406, 429 and 5xx: bot protection, a refused user-agent or a hiccup answered our request.
      notes.push(
        `the canonical target answered HTTP ${page.status} to our request, which is often bot protection; not judged`
      );
    } else {
      const targetNoindex = noindexFor(CRAWLER_KEYS, {
        metas: page.metas,
        xRobotsTag: page.xRobotsTag,
      });
      if (targetNoindex.length) {
        problems.push('the canonical target is itself noindex');
      }
      const next = classifyCanonical(page.url, page.canonicals);
      if (next.kind === 'elsewhere') {
        problems.push(
          `the canonical target declares yet another canonical (${clip(
            /** @type {string} */ (next.target)
          )}): a canonical chain`
        );
      }
      const targetRobots = robotsAccess(input.robotsTxt, page.url);
      if (targetRobots.blocked.length) {
        problems.push(
          `robots.txt blocks ${crawlerNames(targetRobots.blocked)} from the canonical target`
        );
      }
      if (page.bodyRead === 'html' && !page.headComplete && !problems.length) {
        notes.push(
          "only part of the canonical target's <head> was read, so a noindex there is not ruled out"
        );
      }
    }
    target = {page, problems, notes};
  }

  return {
    status: input.status,
    robots,
    noindex,
    canonical,
    canonicalCount: input.canonicals.length,
    target,
  };
}

/**
 * @param {IndexabilityInput} input
 * @return {Array<{conflict: string, why: string}>}
 */
function findConflicts(input) {
  const a = analyze(input);
  /** @type {Array<{conflict: string, why: string}>} */
  const conflicts = [];

  // noindex that robots.txt prevents a crawler from ever reading.
  const hidden = a.noindex.filter(n => a.robots.blocked.includes(n.crawler)).map(n => n.crawler);
  if (hidden.length) {
    conflicts.push({
      conflict: `noindex, but robots.txt blocks ${crawlerNames(hidden)}`,
      why:
        `${crawlerNames(
          hidden
        )} may not fetch the page, so it never sees the noindex and can keep ` +
        'the URL in its index. Allow the page in robots.txt, or drop the noindex and rely on robots.txt.',
    });
  }
  if (a.canonical.kind === 'elsewhere') {
    const target = clip(/** @type {string} */ (a.canonical.target));
    if (a.noindex.length) {
      conflicts.push({
        conflict: `noindex, but the canonical points to ${target}`,
        why:
          'The page says "do not index me" and also "index that other URL instead". Google treats ' +
          'the combination as unreliable. Keep one: noindex, or the canonical.',
      });
    }
    if (a.robots.blocked.length) {
      conflicts.push({
        conflict: `robots.txt blocks ${crawlerNames(
          a.robots.blocked
        )}, but the canonical points to ${target}`,
        why:
          `${crawlerNames(a.robots.blocked)} may not fetch the page, so it cannot read the ` +
          'canonical, which then has no effect.',
      });
    }
    if (a.target) {
      for (const problem of a.target.problems) {
        conflicts.push({
          conflict: `canonical to ${target}, but ${problem}`,
          why:
            'A canonical should point at a final, indexable page. Point it at the live URL ' +
            'that should be indexed.',
        });
      }
    }
  }
  if (a.status !== null && a.status >= 400 && a.canonical.kind !== 'none') {
    conflicts.push({
      conflict: `HTTP ${a.status} page that declares a canonical`,
      why: 'Search engines ignore the canonical of an error page; this usually means an error template emits one.',
    });
  }
  return conflicts;
}

/**
 * @param {IndexabilityInput} input
 * @return {{short: string, long: string}}
 */
function verdictOf(input) {
  const a = analyze(input);
  const conflicts = findConflicts(input);
  const tail = conflicts.length
    ? ' Some signals contradict each other (see indexability-conflicts).'
    : '';
  if (a.status !== null && a.status >= 400) {
    return {
      short: `Not indexable (HTTP ${a.status})`,
      long: `Not indexable: the page returns HTTP ${a.status}, and search engines drop error pages.${tail}`,
    };
  }
  if (a.noindex.length) {
    const who = crawlerNames(a.noindex.map(n => n.crawler));
    return {
      short: 'Not indexable (noindex)',
      long: `Not indexable: ${who} will not index this page because of noindex (${[
        ...new Set(a.noindex.flatMap(n => n.via)),
      ].join(', ')}).${tail}`,
    };
  }
  if (a.robots.blocked.length) {
    return {
      short: 'Blocked by robots.txt',
      long:
        `${crawlerNames(a.robots.blocked)} may not crawl this page, so it cannot be read. It can ` +
        `still appear in results, without a description, if other sites link to it.${tail}`,
    };
  }
  if (a.canonical.kind === 'elsewhere') {
    return {
      short: 'Indexable, canonical elsewhere',
      long: `Crawlable and not noindex, but the canonical points to ${clip(
        /** @type {string} */ (a.canonical.target)
      )}: search engines will usually index that URL instead of this one.${tail}`,
    };
  }
  return {
    short: 'Indexable',
    long: `Nothing stops search engines crawling and indexing this page.${tail}`,
  };
}

/**
 * @param {IndexabilityInput} input
 * @return {Array<{step: string, signal: string, finding: string}>}
 */
function verdictRows(input) {
  const a = analyze(input);
  /** @type {Array<{step: string, signal: string, finding: string}>} */
  const rows = [];

  rows.push({
    step: '1. HTTP status',
    signal: a.status === null ? 'unknown' : `HTTP ${a.status}`,
    finding:
      a.status === null
        ? 'The status of the page could not be read.'
        : a.status >= 400
        ? 'An error status: search engines drop the page.'
        : 'The page is served normally.',
  });

  const robotsSignal =
    a.robots.state === 'unavailable'
      ? 'robots.txt could not be read'
      : a.robots.state === 'absent'
      ? 'no robots.txt'
      : CRAWLER_KEYS.map(
          k => `${CRAWLER_LABEL[k]}: ${a.robots.blocked.includes(k) ? 'blocked' : 'allowed'}`
        ).join(', ');
  rows.push({
    step: '2. robots.txt',
    signal: robotsSignal,
    finding: a.robots.blocked.length
      ? `${crawlerNames(
          a.robots.blocked
        )} may not fetch the page, so they cannot read anything on it.`
      : a.robots.state === 'unavailable'
      ? 'Could not be checked right now.'
      : 'Crawling is allowed.',
  });

  rows.push({
    step: '3. Meta robots and X-Robots-Tag',
    signal: a.noindex.length
      ? a.noindex
          .map(n => `${CRAWLER_LABEL[n.crawler]}: noindex via ${n.via.join(', ')}`)
          .join('; ')
      : 'no noindex',
    finding: a.noindex.length
      ? 'The page asks not to be indexed.'
      : 'Nothing asks search engines to keep the page out of the index.',
  });

  const c = a.canonical;
  const canonicalSignal =
    c.kind === 'none'
      ? 'no canonical'
      : c.kind === 'conflicting'
      ? `${a.canonicalCount} different canonicals`
      : c.kind === 'elsewhere'
      ? clip(/** @type {string} */ (c.target))
      : 'points to itself';
  let canonicalFinding =
    c.kind === 'none'
      ? 'No canonical declared (search engines choose one themselves).'
      : c.kind === 'conflicting'
      ? "Several different canonicals: search engines ignore them (Lighthouse's own canonical audit flags this)."
      : c.kind === 'elsewhere'
      ? 'Asks search engines to index another URL instead.'
      : 'Self-referencing (good).';
  if (a.target) {
    canonicalFinding += a.target.problems.length
      ? ` Target: ${a.target.problems.join('; ')}.`
      : a.target.notes.length
      ? ` Target: ${a.target.notes.join('; ')}.`
      : ` Target checked: HTTP ${a.target.page.status}, indexable.`;
  }
  rows.push({step: '4. Canonical', signal: canonicalSignal, finding: canonicalFinding});

  rows.push({
    step: '5. Text content',
    signal:
      input.bodyTextLength === null
        ? 'unknown'
        : `${input.bodyTextLength} characters of visible text`,
    finding:
      input.bodyTextLength === null
        ? 'Not measured.'
        : input.bodyTextLength < MIN_TEXT_CHARS
        ? `Under ${MIN_TEXT_CHARS} characters: little for a search engine to index (a page that builds its content late with JavaScript can look empty).`
        : 'There is text to index.',
  });
  return rows;
}

/** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
const VERDICT_HEADINGS = [
  {key: 'step', valueType: 'text', label: 'Step'},
  {key: 'signal', valueType: 'text', label: 'What the page says'},
  {key: 'finding', valueType: 'text', label: 'What it means'},
];

/**
 * @param {IndexabilityInput | null} input
 * @return {Product}
 */
function verdictProduct(input) {
  if (!input || input.status === null) {
    return {
      score: 1,
      notApplicable: true,
      explanation: "The page's HTTP status could not be read.",
    };
  }
  const verdict = verdictOf(input);
  return {
    score: 1,
    displayValue: verdict.short,
    explanation: verdict.long,
    details: Audit.makeTableDetails(VERDICT_HEADINGS, verdictRows(input)),
  };
}

/**
 * @param {IndexabilityInput | null} input
 * @return {Product}
 */
function conflictsProduct(input) {
  if (!input || input.status === null) {
    return {
      score: 1,
      notApplicable: true,
      explanation: "The page's HTTP status could not be read.",
    };
  }
  const conflicts = findConflicts(input);
  if (!conflicts.length) return {score: 1};

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'conflict', valueType: 'text', label: 'Signals that contradict each other'},
    {key: 'why', valueType: 'text', label: 'Why it matters and what to do'},
  ];
  return {
    score: 0,
    displayValue: conflicts.length === 1 ? '1 conflict' : `${conflicts.length} conflicts`,
    explanation: conflicts.map(c => `${c.conflict}.`).join(' '),
    details: Audit.makeTableDetails(headings, conflicts),
  };
}

export {
  classifyCanonical,
  robotsAccess,
  findConflicts,
  verdictOf,
  verdictRows,
  verdictProduct,
  conflictsProduct,
  MIN_TEXT_CHARS,
};
