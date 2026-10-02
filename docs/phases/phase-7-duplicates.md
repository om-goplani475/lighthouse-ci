# Phase 7 — Duplicate & Consistency Detection (site-wide)

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-7-duplicates` (off `main`), the
sixth phase to use the phase-branch workflow in `AGENTS.md`. Merges into `main` only once every item is done,
deferred, to-do-later, or marked not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

**Status: complete (2026-10-02).** All four audits and the crawler core are done, QA'd live and security-reviewed (`docs/qa/site-crawler.md`, `docs/qa/phase-7-cross-page-audits.md`); see "Closing record" at the bottom.

## Planning decisions (2026-10-01)

Every row of this phase compares one page with others, and every audit in the fork so far judges one page. The
repo has no crawler, so three decisions were confirmed with the developer:

1. **Build the real crawler first**, rather than a sample-based shortcut over the Phase 4 sitemap sample or a
   multi-run aggregator. It is the "Multi-page / Site-wide Crawling Infrastructure" item in the master roadmap,
   and Phase 8 (internal linking), the deferred Phase 5 link checks and Phase 11 build on it too.
2. **All four rows are wanted now**: duplicate titles and descriptions, thin content / text-to-HTML ratio,
   conflicting canonicals across pages, and exact duplicate content (a hash of the visible text).
3. **Crawler design** (the blocking questions of the intake): it runs **inside the Lighthouse run as a
   gatherer, with an on-disk cache keyed by origin** (each `lhci collect` run is its own child process, so a
   cache is how a multi-URL or multi-run collect crawls once; no workflow change, `lhci autorun` just works);
   it **honours robots.txt by default** (an environment variable can turn that off for your own staging);
   default bounds **50 pages and 120 s**, overridable by environment variables and never by the page.
4. **Scaled down to a core first** (2026-10-01): after asking whether a full crawler was necessary now, the developer chose
   the crawler *core* (bounded fetch, versioned snapshot, disk cache), seeded from the sitemap URLs and the audited page's
   own links **at depth 1**. Link-following to a greater depth waits for Phase 8, the first consumer that needs it; the
   snapshot already stores each page's links, so nothing built now is thrown away.

## Features

| # | Feature | Status | Slug / notes |
|---|---------|--------|--------------|
| 0 | Multi-page crawler core (prerequisite) | **done** | `site-crawler`, full 9-stage pipeline: bounded same-origin fetch at depth 1, versioned snapshot, on-disk cache, `SiteCrawl` gatherer. Spec: `docs/feature-specs/site-crawler.md`. |
| 1 | Duplicate titles and duplicate meta descriptions across crawled pages | **done** | `duplicate-titles`, `duplicate-descriptions` (one shared lib, `crawl-duplicates.js`), built lightweight after a short design conversation: exact match after trim + case-fold, empties ignored, fails when the audited page shares a value with at least one other crawled page. QA'd live with `lhci collect` + `lhci assert` against a local site. |
| 2 | Text-to-HTML ratio / thin-content flagging | **done** | `thin-content` (lib `crawl-thin.js`), lightweight after a short design conversation: under 200 words fails the audited page; ratio shown, never judged; other thin crawled pages listed, not judged; not applicable for script-built or truncated pages. QA'd live with `lhci collect` + `lhci assert`. |
| 3 | Duplicate or conflicting canonical declarations across pages | **done** | `canonical-conflicts` (lib `crawl-canonicals.js`), lightweight after a short design conversation: chain, loop, bad target and mixed target, from the snapshot with no request. Fails when the audited page is the bad target of other pages' canonicals; its own target stays with Phase 6's `indexability-conflicts`; other pages' conflicts are listed, not judged. QA'd live with `lhci collect` + `lhci assert`. |
| 4 | Exact duplicate visible content (hash of normalised text) | **done** | `duplicate-content` (lib `crawl-duplicate-content.js`), lightweight after a short design conversation: exact hash match, pages under 50 words not compared, a page canonical to another URL is not counted, trailing-slash/query duplicates noted, audited page judged and other groups listed; not applicable for script-built or truncated pages. QA'd live with `lhci collect` + `lhci assert`. |

## How the plan changed while building

- **`htmlparser2`, not `parse5`, reads page bodies.** The design's open question (can full-body parsing be made safe?) was settled by
  measurement: `parse5` took 109 s on one 512 KiB nested page, `htmlparser2` 53 ms. It is already in the dependency tree, so
  `yarn.lock` is unchanged.
- **A new `userAgent` option on `safeFetchPrefix`** so the crawler identifies itself; `safeFetchBytes` (robots.txt, sitemaps) got the same
  option afterwards (security Finding 8, low, fixed).
- **Found while building**: Node's recursive `mkdir` hangs on an uncreatable path (the cache now creates one directory level only).
- **A QA note was reworded**: a static site that serves a browser a bigger page than a bot is not "built by script".

## Deferred

| Item | Deferred | Why |
|------|----------|-----|
| Near-duplicate content (similarity / shingling) | after exact-hash duplicates | the roadmap says "hash-based, then similarity"; the hash comes first and shingling is a separate cost and false-positive decision |
| Inconsistent URL representations resolving to the same page | not selected for this phase | partly covered for one URL by `url-variant-consistency` (Phase 5); the site-wide version can reuse the snapshot later |

## To do later

| Item | When | Notes |
|------|------|-------|
| Link-following beyond depth 1 (the full crawler) | Phase 8 | needed by the link graph, orphan pages, crawl depth and the deferred Phase 5 link checks; the snapshot already stores each page's internal links |
| Phase 8 (internal linking and site graph) and the deferred Phase 5 link checks | after the crawler | they read the same snapshot |
| A separate `seo-crawl` command writing the snapshot ahead of `lhci collect` | if the in-run crawl time proves a problem | the crawler is a library, so a command is a thin addition |

## Not possible / permanently out of scope

None identified yet.

## Closing record (2026-10-02)

- **Shipped (1 gatherer, 6 audits)**: the crawler core (`SiteCrawl`, informational `crawl-coverage`), then `duplicate-titles`,
  `duplicate-descriptions`, `thin-content`, `canonical-conflicts` and `duplicate-content`. The fork has **46 audits** in `seo-extended`.
- **Pipeline used**: the crawler core ran the full 9-stage pipeline; each audit on top was lightweight after a short design conversation
  (thresholds and rules confirmed with the developer: exact match after trim and case-fold, 200 words is thin, 50 words minimum to compare).
- **Real findings worth keeping**: (1) the crawler is bounded and cache-secure (hostile servers and cache attacks all defeated); (2) a
  note claiming "built by script" was false for a server that answers bots differently, now worded accurately; (3) a quadratic slash regex
  in `duplicate-content` (Finding 9, fixed); (4) a typecheck error I missed by reading only the end of the output (caught later, fixed).
  Security Finding 8 (no user-agent on robots.txt and sitemap requests) was fixed too; **no finding is open**.
- **Tests**: 1,308 `seo-audits` tests pass; typecheck and lint are clean. The full `npm run test:quick` shows 11 failing suites (92 tests),
  all in `cli`, `server`, `viewer` and `utils` (CLI, server e2e/Storybook, viewer e2e, utils build-context): the same families recorded as
  failing before Phase 4 (see `.ai-agents/state/ci-backlog.md`), none in `seo-audits`.
- **Not verified**: `packages/viewer` rendering of the new audits, `npm run start:seed-database` and a real GitHub Actions run (the
  developer deferred these until after Phase 7), and the audits on real public sites.
- **Deferred**: near-duplicate content, inconsistent URL representations site-wide, link-following beyond depth 1 (Phase 8).
