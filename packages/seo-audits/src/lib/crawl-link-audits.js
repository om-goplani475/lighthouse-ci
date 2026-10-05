/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builders for the four link-graph audits: `dead-end-pages`, `internal-link-counts`,
 * `orphan-pages` and `crawl-depth`. They read the site crawl's snapshot only (no request). No I/O, never throws.
 *
 * Rules, chosen with the developer:
 *   - a dead end has no followable internal link to a different page (nofollow and self links do not count);
 *   - internal link counts are judged against fixed thresholds: fewer than `MIN_INLINKS` internal links pointing at
 *     the page is low, more than `MAX_OUTLINKS` on it is high (zero inbound links is left to `orphan-pages`);
 *   - a page is an orphan when no crawled page links to it, judged only when the crawl saw the whole site;
 *   - crawl depth is the click distance from the homepage, and the audited page fails beyond `MAX_DEPTH` clicks.
 * Each audit judges the audited page and lists the other offending pages without failing on them.
 *
 * Links are read from server HTML, so when the audited page looks to be built by script every audit here is not
 * applicable. Inbound links, orphans and depth are statements about the pages the crawl saw; where a partial
 * crawl could make the answer wrong, the audit says so instead (an over-large depth might have a shorter
 * path, a missing inbound link might sit on a page not crawled).
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildGraph, crawlCompleteness, clickDepths, homeNode} from './crawl-graph.js';
import {scriptBuiltContent} from './crawl-coverage.js';

/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-graph.js').GraphNode} GraphNode */
/** @typedef {import('./crawl-graph.js').LinkGraph} LinkGraph */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_DEPTH = 3;
const MIN_INLINKS = 2;
const MAX_OUTLINKS = 150;
const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;

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
 * The distinct internal pages a page links to with a followable link, other than itself. Counted from the page's
 * own links, not only the crawled ones, so a link to a page the crawl did not reach still counts.
 * @param {GraphNode} node
 * @return {Set<string>}
 */
function outgoing(node) {
  return node.targets;
}

/**
 * The checks every audit here starts with.
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {{product: Product} | {
 *   snapshot: import('./crawl-snapshot.js').CrawlSnapshot, graph: LinkGraph, audited: GraphNode,
 *   completeness: ReturnType<typeof crawlCompleteness>,
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
  const graph = buildGraph(snapshot);
  const page = snapshot.pages.find(p => p.source === 'audited' && p.extraction === 'ok');
  const audited = page && graph.resolve(page.finalUrl || page.url);
  if (!page || !audited) {
    return {
      product: notApplicable(
        'The crawler did not receive the audited page as HTML, so its links were not read.'
      ),
    };
  }
  const script = scriptBuiltContent(artifact);
  if (script) {
    return {
      product: notApplicable(
        `The audited page shows ${script.rendered} characters of text in a browser but only ${script.server} in the HTML the crawler received, so its links cannot be read from server HTML.`
      ),
    };
  }
  return {snapshot, graph, audited, completeness: crawlCompleteness(snapshot)};
}

/**
 * @param {Array<Record<string, string | number>>} items
 * @param {number} total
 * @param {Record<string, string | number>} blank
 * @return {Array<Record<string, string | number>>}
 */
function capRows(items, total, blank) {
  const shown = items.slice(0, MAX_ROWS);
  if (total > shown.length) shown.push({...blank, page: `${total - shown.length} more not shown`});
  return shown;
}

/**
 * @param {string} url
 * @param {GraphNode} node
 * @return {string}
 */
function label(url, node) {
  return clip(node.page.finalUrl || url);
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildDeadEndProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {graph, audited} = prep;
  const auditedTargets = outgoing(audited);
  const dead = auditedTargets.size === 0;
  const others = [...graph.nodes.values()].filter(
    node => node !== audited && node.page.extraction === 'ok' && outgoing(node).size === 0
  );

  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  const rows = [
    ...(dead
      ? [{page: label(audited.key, audited), note: 'the audited page: no links to other pages'}]
      : []),
    ...others.map(node => ({
      page: label(node.key, node),
      note: 'other crawled page: no links to other pages',
    })),
  ];
  const otherNote = others.length
    ? ` ${count(others.length, 'other crawled page')} also ${
        others.length === 1 ? 'has' : 'have'
      } none (listed, not judged).`
    : '';
  return {
    score: dead ? 0 : 1,
    displayValue: dead
      ? 'No links to other pages'
      : `${count(auditedTargets.size, 'internal link')} to other pages`,
    explanation: dead
      ? `The audited page has no followable internal link to another page, so a visitor or crawler arriving here has nowhere to go but back. Link to related pages, or to the homepage or a parent section.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(headings, capRows(rows, rows.length, {note: ''})),
  };
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildLinkCountsProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {snapshot, graph, audited, completeness} = prep;
  const home = homeNode(snapshot, graph);
  const isHome = home === audited;
  const out = outgoing(audited).size;
  const inbound = audited.in.size;
  const tooMany = out > MAX_OUTLINKS;
  // Zero inbound links is `orphan-pages`' finding; one is "low". Inbound links are only known for the pages the
  // crawl read, so on a partial crawl the low side is not judged.
  const tooFew = completeness.complete && !isHome && inbound > 0 && inbound < MIN_INLINKS;

  /** @type {Array<Record<string, string | number>>} */
  const rows = [
    {
      page: label(audited.key, audited),
      inbound: completeness.complete ? inbound : `${inbound}+`,
      outbound: out,
      note: [
        tooMany ? `over ${MAX_OUTLINKS} internal links` : '',
        tooFew ? `fewer than ${MIN_INLINKS} pages link here` : '',
        !completeness.complete ? 'inbound count may be higher: the crawl was partial' : '',
        completeness.complete && inbound === 0 && !isHome
          ? 'no inbound links: see orphan-pages'
          : '',
      ]
        .filter(Boolean)
        .join('; '),
    },
  ];
  /** @type {Array<Record<string, string | number>>} */
  const otherRows = [];
  for (const node of graph.nodes.values()) {
    if (node === audited || node.page.extraction !== 'ok') continue;
    const nodeOut = outgoing(node).size;
    const high = nodeOut > MAX_OUTLINKS;
    const low =
      completeness.complete && node !== home && node.in.size > 0 && node.in.size < MIN_INLINKS;
    if (high || low) {
      otherRows.push({
        page: label(node.key, node),
        inbound: node.in.size,
        outbound: nodeOut,
        note: high
          ? `other crawled page: over ${MAX_OUTLINKS} internal links`
          : `other crawled page: fewer than ${MIN_INLINKS} pages link here`,
      });
    }
  }
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page'},
    {key: 'inbound', valueType: 'text', label: 'Pages linking here'},
    {key: 'outbound', valueType: 'text', label: 'Internal links on the page'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  const failing = tooMany || tooFew;
  const problems = [
    tooMany
      ? `${count(
          out,
          'internal link'
        )} on the page (more than ${MAX_OUTLINKS} dilutes each link and is hard to use)`
      : '',
    tooFew
      ? `only ${count(
          inbound,
          'crawled page'
        )} links to it (fewer than ${MIN_INLINKS}, so it is hard to find and gets little internal authority)`
      : '',
  ].filter(Boolean);
  return {
    score: failing ? 0 : 1,
    displayValue: `${completeness.complete ? inbound : `${inbound}+`} in, ${out} out`,
    explanation: failing
      ? `The audited page's internal link counts are unusual: ${problems.join('; ')}.${
          otherRows.length
            ? ` ${count(otherRows.length, 'other crawled page')} also ${
                otherRows.length === 1 ? 'is' : 'are'
              } outside the thresholds (listed, not judged).`
            : ''
        }`
      : undefined,
    details: Audit.makeTableDetails(
      headings,
      capRows([...rows, ...otherRows], rows.length + otherRows.length, {
        inbound: '',
        outbound: '',
        note: '',
      })
    ),
  };
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildOrphanProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {snapshot, graph, audited, completeness} = prep;
  if (!completeness.complete) {
    return notApplicable(
      `Whether no page links to this one is only known if the crawl saw the whole site, and here ${completeness.reasons.join(
        '; '
      )}. Raise LHCI_SEO_CRAWL_MAX_PAGES or LHCI_SEO_CRAWL_MAX_DEPTH, or audit a smaller site, to judge orphans.`
    );
  }
  const home = homeNode(snapshot, graph);
  if (home === audited) {
    return notApplicable(
      'The audited page is the homepage, the root of the link graph, which is not judged as an orphan.'
    );
  }
  const orphan = audited.in.size === 0;
  const others = [...graph.nodes.values()].filter(
    node => node !== audited && node !== home && node.page.extraction === 'ok' && node.in.size === 0
  );
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page'},
    {key: 'found', valueType: 'text', label: 'Found by the crawl through'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  /** @type {Record<string, string>} */
  const via = {
    audited: 'being audited',
    home: 'being the homepage',
    link: 'a link',
    sitemap: 'the sitemap',
  };
  const rows = [
    ...(orphan
      ? [
          {
            page: label(audited.key, audited),
            found: via[audited.page.source] || '',
            note: 'the audited page: no crawled page links to it',
          },
        ]
      : []),
    ...others.map(node => ({
      page: label(node.key, node),
      found: via[node.page.source] || '',
      note: 'other crawled page: no crawled page links to it',
    })),
  ];
  const otherNote = others.length
    ? ` ${count(others.length, 'other crawled page')} ${
        others.length === 1 ? 'is' : 'are'
      } also orphaned (listed, not judged).`
    : '';
  return {
    score: orphan ? 0 : 1,
    displayValue: orphan
      ? 'No crawled page links to it'
      : `${count(audited.in.size, 'page')} link${audited.in.size === 1 ? 's' : ''} to it`,
    explanation: orphan
      ? `No page on the crawled site links to the audited page, so crawlers and visitors can only find it from outside (a sitemap, a bookmark or another site). Link to it from a related page or a section index.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(headings, capRows(rows, rows.length, {found: '', note: ''})),
  };
}

/**
 * @param {SiteCrawlArtifact | null | undefined} artifact
 * @return {Product}
 */
function buildCrawlDepthProduct(artifact) {
  const prep = prepare(artifact);
  if ('product' in prep) return prep.product;
  const {snapshot, graph, audited, completeness} = prep;
  const home = homeNode(snapshot, graph);
  if (!home) {
    return notApplicable(
      'The homepage could not be read as HTML, so click depth from it cannot be measured.'
    );
  }
  const depths = clickDepths(graph, home.key);
  const depth = depths.get(audited.key);
  if (depth === undefined) {
    return notApplicable(
      completeness.complete
        ? 'No path of followable links from the homepage to the audited page was found among the crawled pages (see orphan-pages).'
        : `No path of followable links from the homepage to the audited page was found among the crawled pages, but ${completeness.reasons.join(
            '; '
          )}, so one may exist.`
    );
  }
  const tooDeep = depth > MAX_DEPTH;
  if (tooDeep && !completeness.complete) {
    return notApplicable(
      `The audited page is ${count(
        depth,
        'click'
      )} from the homepage along the links the crawl saw, but ${completeness.reasons.join(
        '; '
      )}, so a shorter path may exist.`
    );
  }
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'page', valueType: 'text', label: 'Page'},
    {key: 'depth', valueType: 'text', label: 'Clicks from the homepage'},
    {key: 'note', valueType: 'text', label: 'Note'},
  ];
  const deeper = completeness.complete
    ? [...graph.nodes.values()].filter(
        node => node !== audited && (depths.get(node.key) ?? 0) > MAX_DEPTH
      )
    : [];
  const rows = [
    {
      page: label(audited.key, audited),
      depth,
      note: tooDeep ? `the audited page: deeper than ${MAX_DEPTH} clicks` : 'the audited page',
    },
    ...deeper.map(node => ({
      page: label(node.key, node),
      depth: /** @type {number} */ (depths.get(node.key)),
      note: `other crawled page: deeper than ${MAX_DEPTH} clicks`,
    })),
  ];
  const otherNote = deeper.length
    ? ` ${count(deeper.length, 'other crawled page')} ${
        deeper.length === 1 ? 'is' : 'are'
      } also deeper (listed, not judged).`
    : '';
  return {
    score: tooDeep ? 0 : 1,
    displayValue: depth === 0 ? 'The homepage' : `${count(depth, 'click')} from the homepage`,
    explanation: tooDeep
      ? `The audited page is ${depth} clicks from the homepage, deeper than the ${MAX_DEPTH} this audit allows. Pages buried that deep are crawled less often and get less internal authority. Link to it from a page nearer the homepage.${otherNote}`
      : undefined,
    details: Audit.makeTableDetails(headings, capRows(rows, rows.length, {depth: '', note: ''})),
  };
}

export {
  buildDeadEndProduct,
  buildLinkCountsProduct,
  buildOrphanProduct,
  buildCrawlDepthProduct,
  outgoing,
  MAX_DEPTH,
  MIN_INLINKS,
  MAX_OUTLINKS,
  MAX_ROWS,
};
