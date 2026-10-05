# Phase 8 — Internal Linking & Site Graph

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-8-internal-linking` (off `main`), the seventh phase
to use the phase-branch workflow in `AGENTS.md`. Merges into `main` only once every item is done, deferred, to-do-later, or marked
not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

**Status: in progress (2026-10-05).** Items 0 (the crawler extension), 1 and 2 (the link-graph audits) 3 (the internal link checks), 4 (anchor text) and 5 (pagination) are built and QA'd live; item 6 (broken external links) is the last.

## Planning decisions (2026-10-05)

Phase 7 built a crawler that stops at depth 1 and stores each page's links without anchor text. Nearly every row of this phase needs
the link graph, so four decisions were confirmed with the developer:

1. **All four groups are built in this phase**: graph metrics (link counts, unusually high/low counts, dead ends, orphans, crawl
   depth), internal link checks (broken, redirecting, chains and loops: this includes the three checks deferred from Phase 5),
   anchor-text diversity, and pagination plus infinite-pagination trap detection.
2. **Broken external links are built, on by default, bounded.** A tradeoff named once: every audit run will send a small number of
   status-only requests to third-party hosts the page chooses. It therefore gets its own security design and review (sample size,
   per-host cap, SSRF-protected fetch, no redirects followed, the crawler's user-agent, an environment variable to switch it off) and is
   built as its own item, after the internal checks.
3. **Crawl depth 3**, inside the existing bounds (50 pages, 120 s). Snapshot pages found beyond the cap stay recorded as skipped,
   so the graph audits say how much of the site they saw.
4. **Depth is measured from the homepage.** The crawler requests the site root as an extra seed (one request) alongside the audited
   page and the sitemap URLs.

Implication of 1: the snapshot needs anchor text per link, so its version changes (the cache is keyed by version, so old cache
files are simply ignored).

## Features

| # | Feature | Status | Slug / notes |
|---|---------|--------|--------------|
| 0 | Crawler extension: depth 3 from the homepage, snapshot v2 (anchor text per link, pagination head signals) | **done** | `link-graph-crawler`, **lightweight** (an extension of the existing crawler with decisions already made; the intake spec `docs/feature-specs/link-graph-crawler.md` is kept as the design record, no further design documents). The developer questioned the full pipeline on 2026-10-05 and was right. |
| 1 | Internal link graph: incoming/outgoing counts, unusually high/low counts, dead-end pages | **done** | `internal-link-counts` (over 150 links out, or exactly one crawled page linking in) and `dead-end-pages` (no followable link to another page); shared library `crawl-graph.js`, builders in `crawl-link-audits.js`. Lightweight after a short design conversation. QA'd live. |
| 2 | Orphan page detection and crawl depth from the homepage | **done** | `orphan-pages` (not applicable unless the crawl saw the whole site) and `crawl-depth` (more than 3 clicks from the homepage). Same feature as item 1. QA'd live. |
| 3 | Broken internal links (404/500), and the Phase 5 deferred checks: links that redirect, redirect chains and loops on internal links | **done** | three audits, `broken-internal-links`, `redirecting-internal-links`, `internal-redirect-chains`, lib `crawl-link-checks.js`; every crawled page's links judged, plus up to 100 status-only checks of the audited page's own unread links (`linkChecks` on the crawl artifact). Lightweight after a design conversation. QA'd live. |
| 4 | Anchor-text diversity / over-optimisation signal | **done** | `anchor-text-diversity` (60% of at least 5 editorial links, site-wide navigation excluded) and `descriptive-anchor-text` (generic or empty anchors, added at the developer's choice beyond the roadmap row); lib `crawl-anchors.js`. Lightweight after a design conversation. QA'd live. |
| 5 | Pagination (`rel=next/prev`, view-all pattern) and infinite-pagination trap detection | **done** | `pagination-links`, `paginated-canonical` (a canonical outside the series, a view-all page, passes with a note) and `pagination-trap` (evidence from the crawl, no extra request); lib `crawl-pagination.js`. Lightweight after a design conversation. QA'd live. |
| 6 | Broken external links | **done** | `broken-external-links`: the audited page's own external links (up to 20), status only, at most 2 per host, 15 s budget, a strict fetch that refuses private addresses whatever the opt-in says, no third-party robots.txt. Lightweight with a design conversation and a careful security review. QA'd live. |

Build order: 0 first (everything reads it), then 1 and 2 together, 3, 4, 5, and 6 last.

## How the plan changed while building

- **Item 0 changed the seed split.** The Phase 7 seeds (the page's links and the sitemap) used to fill the whole page cap, which would leave
  link-following no room. Seeds now take at most half of the slots after the audited page and the homepage; the rest is for
  breadth-first link-following, and leftover sitemap URLs fill any slots it leaves spare. The Phase 7 audits therefore see a different,
  deeper sample of pages than before (intended).
- **Added beyond the spec while building**: the sitemap URL list is stored in the snapshot (the orphan audit needs "listed but not
  linked"); the snapshot records whether the page cap, the depth bound or the time budget cut the crawl (`overPageCap`, `cutByDepth`,
  `truncatedByBudget`) so audits that need a complete graph can say they cannot judge; URLs that are plainly files are not requested
  (`not-a-page`); at most 5 query-string variants of one path are requested (`query-variants`, a crawl-trap guard that the pagination-trap audit
  will read as evidence); the link list keeps one entry per target *and anchor text*, so anchor diversity can be judged.
- **Items 1 and 2 were built together as four audits on one graph library** (`dead-end-pages`, `internal-link-counts`, `orphan-pages`,
  `crawl-depth`), with thresholds chosen with the developer: 3 clicks from the homepage, fixed link-count thresholds (150 out, fewer than 2 in),
  a dead end is a page with no followable link to another page, and orphans are only judged when the crawl saw the whole site. Two rules I added
  from the same logic and stated up front: the low-inbound side of the counts audit is also only judged on a complete crawl, and a depth beyond
  the limit is only judged on a complete crawl (a shorter path may exist) while a depth within it is always reliable.
- **A consequence worth knowing**: with the defaults (50 pages) `orphan-pages` will usually be not applicable on a site of more than a few dozen pages,
  and says why. That is the price of never reporting a wrong orphan.
- **Found in QA**: the unreachable-page message of `crawl-depth` pointed at `orphan-pages` even on a partial crawl, where the honest statement is "a path
  may exist"; fixed. A timing measurement found 1.7 s worst case on a hostile complete graph of long URLs (links were normalised several times); each
  page's targets are now computed once (0.37 s).
- **Item 3 added a new, per-run kind of data: `linkChecks`.** The shared snapshot cannot hold statuses for the audited page's own links, since which page is audited
  differs from run to run, so a bounded status-only check (up to 100 same-origin targets, 2 KiB per body, robots.txt honoured, 30 s) runs per Lighthouse run and
  is attached to the crawl artifact, not the cache. The developer chose to judge every crawled page's links, three audits, and note-only temporary redirects.
- **Found in live QA of item 3, both fixed with tests**: (1) a redirect whose destination the crawl had already requested left the entry on the 3xx, so the audit
  showed the wrong destination and could not see that the destination was broken: the audits now resolve the chain through the pages the crawl holds; (2) the
  status checks shared one "already requested" set, so a second link redirecting to the same place stopped at the redirect (they now follow each to its end).
- **A bug in item 0's crawler, found by the hostile run of item 3 and fixed**: URLs the time budget stopped the crawler from requesting were recorded as pages that
  "did not answer"; they are now recorded as skipped ("not checked"). It would have made `broken-internal-links` call unreached links broken.
- **Item 4 changed the extractor slightly**: an anchor's text falls back to the image alt text and then to `aria-label` or `title`, so an icon link with a label is not
  called empty. This changes stored anchors for an already-cached version 2 snapshot (cache lifetime 10 minutes), which is harmless.
- **Found in live QA of item 4**: the first rule for "site-wide navigation" (a link on at least half the pages) wrongly exempted an anchor repeated on half the
  site, which is the very pattern the audit is for; navigation is now a link on at least 80% of the crawled pages (with a regression test).
- **Item 5 widened the audited page's status checks** to its `rel=next` / `rel=prev` targets (they are `<link>` elements, not in its link list).
- **The trap rule had to be widened while building** (live QA): the crawl follows 3 hops, so a chain that only offers "next" never reached the 6 variants the first rule needed and an
  endless series passed. Variants only *pointed at* by a `rel=next` now count too, and the trap needs more than 5 known variants and a series still going; at the default depth a
  next-only chain is reported as "too few to call it a trap", and with `LHCI_SEO_CRAWL_MAX_DEPTH=5` the same site fails. A limit of the rule the developer chose (evidence only, no extra
  requests), stated in the README.
- **A performance fix found by the hostile timing run**: 3.9 s for `pagination-links` on 200 pages with 1,900-character URLs (a scan per lookup); pages are now indexed by URL once: 175 ms.
- **Item 6 added a strict fetch to `safe-fetch.js`** (`safeFetchPublicPrefix`, `publicOnlyLookup`, one shared lookup factory): the private-network opt-in that lets the audit reach the audited site on
  localhost must not apply to a link on its page, or a page could aim a request at loopback or an internal address. A test with the opt-in on proves a link to a local server is refused and the server
  receives nothing. The decisions with the developer: the audited page's own links only (up to 20), 404/410/unreachable host fails (5xx and timeouts listed, 401/403/429/999 not judged), no third-party
  robots.txt, 2 requests per host and 15 s.
- **Found in QA of item 6**: status 999 (LinkedIn's way of blocking checkers) was classed as a server error because it is above 500; it is now "not judged". The summary text lumped private-address
  refusals under "answered 401, 403, 429"; they are counted separately.
- **Item 0 was first set up for the full 9-stage pipeline, then switched to lightweight** (2026-10-05) after the developer asked why: it extends
  existing code rather than adding a new capability, so `build-mode-selection.md` points to lightweight. Items 1 to 5 are lightweight; item 6
  (external links, a new outbound surface) gets a short design conversation and a careful security review, not the full pipeline.

## Deferred

| Item | Deferred | Why |
|------|----------|-----|
| Status checks of internal link targets the crawl did not reach | decided in item 3 | the crawl requests every page it follows, so those have statuses; the rest is item 3's design question |

## To do later

| Item | When | Notes |
|------|------|-------|
| Everything in the "To do later" table of `docs/phases/phase-7-duplicates.md` that is not built here | after this phase | e.g. a separate `seo-crawl` command if the in-run crawl time becomes a problem |

## Closing record (2026-10-05)

- **Shipped (1 crawler extension, 2 per-run check kinds, 17 audits)**: the crawler now follows links to depth 3 from the homepage and stores a version 2 snapshot (anchors, external links, pagination, depth, completeness flags);
  per-run status checks of the audited page's own internal links (up to 100) and external links (up to 20). Audits: `dead-end-pages`, `internal-link-counts`, `orphan-pages`, `crawl-depth`,
  `broken-internal-links`, `redirecting-internal-links`, `internal-redirect-chains`, `anchor-text-diversity`, `descriptive-anchor-text`, `pagination-links`, `paginated-canonical`, `pagination-trap`,
  `broken-external-links` (13). The fork has **59 audits** in `seo-extended`. QA records: `docs/qa/link-graph-crawler.md`, `link-graph-audits.md`, `link-check-audits.md`, `anchor-text-audits.md`,
  `pagination-audits.md`, `external-link-audit.md`.
- **Pipeline used**: every item lightweight, each after a short design conversation (thresholds and rules chosen with the developer); the first set-up of item 0 for the full pipeline was reversed at the developer's
  request, and the per-item mode table is in the "How the plan changed" section.
- **Real findings from QA worth keeping** (each fixed with a test): (1) the seed split filled the page cap and left no room to follow links; (2) a time-budget bug since Phase 7 recorded never-requested URLs as
  pages that "did not answer", which would have made the broken-link audit lie; (3) four wrong first rules found by live runs (navigation threshold, redirect destinations, the trap rule, status 999); (4) three
  quadratic scans found by hostile timing runs (slash regex, link normalising, pagination lookups); (5) a strict fetch was needed so the localhost opt-in could never reach a link's target.
- **Security**: one `low` finding, open and accepted (Finding 10: a hostile site with very long link URLs can make the snapshot exceed the 16 MiB cache cap). The new third-party request surface (item 6) was reviewed
  with attacks run against the real fetch path; see `.ai-agents/state/security-findings.md`.
- **Tests**: 82 suites / 1,670 `seo-audits` tests pass, typecheck and lint clean. **Not verified**: the audits on real public sites, `packages/viewer` rendering, `npm run start:seed-database`, a real GitHub
  Actions run, and the Node 18.20.8 re-run (all listed, with steps, in `docs/open-items.md`).
- **Deferred**: see the "Deferred" and "To do later" tables above (near-duplicate content is Phase 7's; everything else this phase planned was built).

## Not possible / permanently out of scope

None identified yet.
