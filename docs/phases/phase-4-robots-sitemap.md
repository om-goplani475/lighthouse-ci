# Phase 4 — Robots.txt & Sitemap

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-4-robots-sitemap` (off
`main`), the third phase to use the phase-branch workflow in `AGENTS.md`. Merges into `main` only
once every item is done, deferred, to-do-later, or marked not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

**Status: all ten tracker rows (the roadmap's twelve bullets) resolved 2026-10-01; no security finding
open.** Ten audits shipped, taking the fork to 31. **Merged into `main`** (`--ff-only`, 2026-10-01,
branch deleted; see "Closing record" at the bottom).

## Planning decisions (2026-09-30)

- **Batching**: robots.txt items first as one bounded group (lightweight mode); sitemap items
  second; the cross-check items and `llms.txt` each get a short design conversation before code.
- **Sitemap URL checks are a bounded sample**, not a crawl: status-only requests
  (`safeFetchStatus`) against up to N sitemap URLs (default 10-20, configurable), reported as a
  sample. Full-sitemap verification waits for the multi-page crawler.
- **robots.txt source**: Lighthouse core's own `RobotsTxt` artifact (`{status, content}`) — no new
  gatherer and no new outbound fetch for robots.txt itself. Sitemaps (a URL discovered on the page's
  origin) *will* need fetching and go through `src/lib/safe-fetch.js`.
- **Matching**: `robots-parser` (already a Lighthouse dependency) for allow/disallow decisions.
  Its per-UA fallback differs from Google's for `Googlebot-Image` (it falls back to `*`, Google to
  the `googlebot` group first), so a small group parser in `src/lib/robots-txt.js` handles that
  fallback and conflict detection.

## How the plan changed while building (so the decisions above are not read as the final design)

- **Sitemap work became a shared gatherer.** The planning note above said "no new gatherer"; that held
  for the robots.txt audits (core's `RobotsTxt` artifact), but the sitemap audits needed a new one:
  `SitemapDocuments` discovers robots.txt `Sitemap:` lines (else `/sitemap.xml`), fetches and parses every
  sitemap once (gzip, one level of index, 10 files, parsed with `saxes`), and every sitemap audit reads
  it. It was the first gatherer in this package with outbound requests, so it went through the full
  9-stage pipeline.
- **The page sample is shared too.** The same gatherer now requests the sampled sitemap URLs once each
  (status, headers, the first 64 KiB of 2xx HTML reduced to meta-robots and canonical signals with
  `parse5`), and both `sitemap-url-status` and `sitemap-indexability` read it, so checking status and
  indexability costs no extra requests. `sitemap-url-status` was refactored onto it behind a
  characterization test whose expected values were captured before the change.
- **Security work that was not planned, all done:** two `high` findings found by running attacks during
  the sitemap review (an SSRF bypass through bracketed IPv6 literals, in `safe-fetch.js` since Phase 1;
  and a quadratic-time XML parser denial of service), a `medium` one in `parse5` found during the
  indexability build, and a gatherer-wide time budget. See `.ai-agents/state/security-findings.md`.
- **A private-network opt-in was added** (`LHCI_SEO_ALLOW_PRIVATE_NETWORK`) after the developer confirmed
  CI audits `localhost`/staging, where the SSRF policy refused the page's own robots.txt and sitemap.
  It unblocks only loopback, RFC 1918 and IPv6 unique-local; the metadata address and link-local stay
  blocked even with it on.
- **Sample size is an environment variable**, `LHCI_SEO_SITEMAP_SAMPLE_SIZE` (default 10, clamped 1-25),
  not a config key: it bounds requests to the audited site, so a page must not be able to change it.
- **`llms.txt` was tuned against real files**: the first version failed Anthropic's and Stripe's files over
  stylistic deviations, so only unambiguous violations fail now.

## Features

| # | Feature | Status | Slug / notes |
|---|---------|--------|--------------|
| 1 | Sitemap declared in robots.txt | **done** | `robots-txt-sitemap-declared`, QA'd live see `docs/qa/robots-txt-sitemap.md`. Reads core's `RobotsTxt` artifact; no new gatherer. |
| 2 | Per-UA crawl simulation + important page / CSS / JS blocked | **done** | `robots-txt-crawler-access`, QA'd live see `docs/qa/robots-txt-sitemap.md`. One audit: table of Googlebot, Googlebot-Image, Bingbot and AI crawlers (GPTBot, ClaudeBot, CCBot, PerplexityBot) vs the audited URL and same-origin CSS/JS. Scored on search-engine UAs only; AI-crawler blocking is informational (a legitimate choice) |
| 3 | Conflicting Allow/Disallow rules | **done** | `robots-txt-rule-conflicts`, QA'd live see `docs/qa/robots-txt-sitemap.md`. Identical-path Allow/Disallow for one user-agent (duplicate groups merged); wildcard overlaps not detected |
| 4 | XML sitemap valid / well-formed | **done** | `sitemap-valid`, from the shared `SitemapDocuments` gatherer (full 9-stage pipeline: `docs/feature-specs/sitemap-fetch-and-parse.md`); QA'd live, see `docs/qa/sitemap-fetch-and-parse.md`. Redirecting sitemap URLs are reported, not followed. |
| 5 | Sitemap URLs return 200 (bounded sample) | **done** | `sitemap-url-status`, built lightweight-mode on the shared `SitemapDocuments` artifact; QA'd live (found a real bug in nodejs.org's own sitemap), see `docs/qa/sitemap-fetch-and-parse.md`. Evenly spread deterministic sample, default 10 (`LHCI_SEO_SITEMAP_SAMPLE_SIZE`, max 25), only 2xx passes, same-origin URLs only. Status only: `noindex` is left to item 9. |
| 6 | Duplicate URLs in sitemap | **done** | `sitemap-duplicate-urls`, exact-string match within each file. Found a real duplicate on MDN's live sitemap during QA. |
| 7 | Sitemap size/URL limits, gzip, sitemap index | **done** | `sitemap-limits` plus gzip and one-level index support in the gatherer. At most 10 documents per run; truncation is reported. |
| 8 | Sitemap ↔ robots.txt ↔ crawlability cross-check | **done** (design settled 2026-09-30) | `sitemap-robots-crossref`, lightweight mode; QA'd live, see `docs/qa/sitemap-fetch-and-parse.md`. Reads `SitemapDocuments` + core's `RobotsTxt`; no extra requests. Scored: any same-origin sitemap URL that robots.txt disallows for Googlebot or Bingbot (checks *all* stored URLs, lists the first few), and a declared sitemap URL whose own path is disallowed. Informational only, never affects score: whether the audited page is listed in the sitemap. |
| 9 | Sitemap vs indexability conflict | **done** (design settled 2026-09-30) | `sitemap-indexability`; QA'd live, see `docs/qa/sitemap-indexability.md` (found a real noindex in MDN's own sitemap). Full pipeline for the gatherer (new capability: bounded HTML read). One new gatherer requests each sampled sitemap URL once, reading status, headers and only the first ~64 KiB of HTML; `sitemap-url-status` is refactored to read it (same results and bounds, no extra requests), and a new audit flags **noindex** (X-Robots-Tag or meta robots) and **canonical pointing elsewhere** on a listed URL. Blocked-by-robots.txt is not repeated here (item 8). |
| 10 | `llms.txt` presence/validity | **done** (design settled 2026-09-30) | `llms-txt-structure`, lightweight mode; QA'd live against Stripe, Anthropic, nodejs.org and llmstxt.org, see `docs/qa/sitemap-fetch-and-parse.md`. Scored on **structure when present**: absent is not-applicable (the file is optional and only a proposal, llmstxt.org, Jeremy Howard, Sept 2024; not verified that any major search engine uses it, and the audit must say so, not imply SEO value). Present but invalid fails, but only on unambiguous violations (no H1, HTML served instead of markdown, a broken or empty link, an unsupported scheme); stylistic deviations real files use (plain items, sub-bullets, prose links) are notes, tuned against real files. Fetched through `safe-fetch.js` at the page origin's `/llms.txt`. |

## Deferred

| Item | Deferred | Why |
|---|---|---|
| 10 (llms.txt) | Checking that the links inside llms.txt resolve, `llms-full.txt`, and `llms.txt` at a subpath | The spec mentions none of the first two; the structure check is what was chosen. Reachability would reuse the bounded status check and can be added later without changing the audit's contract. |
| 4 (sitemap-valid) | Following redirects for a sitemap URL (Google does; this reports them and says to declare the final URL) | Needs a new redirect-following mode in `safe-fetch.js` that re-validates every hop: a real change to the security-reviewed fetch path, not worth it for a recommendation. |
| 4/7 (sitemap formats) | Validating the image/video/news/`xhtml:link` extensions, text/RSS/Atom sitemaps, an index nested more than one level | Tolerated but not validated, so they are never reported as invalid; each is its own feature. |
| 8 (sitemap-robots-crossref) | The "sitemap's own path is disallowed" check is worded as "verify", not as fact | Google's sitemap documentation does not say whether robots.txt applies to sitemap files (checked 2026-09-30). Drop that check if it proves wrong. |
| 9 (sitemap-indexability) | HTTP `Link: <...>; rel="canonical"` headers, canonical chains, and whether a canonical's target is itself indexable | Rare / needs further requests per URL; the target check belongs with the Phase 6 decision tree. |

## To do later

| Item | Basic version built | Advanced alternative, not built | Why not built now |
|---|---|---|---|
| 3 (robots-txt-rule-conflicts) | Identical path strings only | Wildcard/`$` overlap detection (`/a*` vs `/ab`) | Needs a pattern-intersection routine; the exact-match case is the common real mistake |
| 5 (sitemap-url-status) | A bounded evenly spread sample, default 10 (max 25) | Check every listed URL | Needs the multi-page crawler (Phases 5 and 8); a full check would hammer the audited site. Also pinned, not fixed: the audit scores 1 when the time budget leaves most sampled URLs "not checked" (with a note). |
| 7 (sitemap-limits) | The first 10 sitemap files of a run, truncation reported | Every child sitemap | The cap and the 40 s budget are the security bounds; the crawler could lift them safely. |
| 9 (sitemap-indexability) | Signals from the raw HTML head of a plain request | A noindex or canonical injected by client-side JavaScript | Needs a browser render per sampled URL (Phase 12, JavaScript rendering parity); the audit's own description says this plainly. |

## Not possible / permanently out of scope

*(none: everything not built is a choice or waits on infrastructure that does not exist yet, listed above)*

## Closing record (2026-10-01)

- **Shipped (10 audits, all QA'd live with real `lhci collect`/`assert`)**: `robots-txt-sitemap-declared`,
  `robots-txt-crawler-access`, `robots-txt-rule-conflicts`, `sitemap-valid`, `sitemap-duplicate-urls`,
  `sitemap-limits`, `sitemap-url-status`, `sitemap-robots-crossref`, `sitemap-indexability`,
  `llms-txt-structure`. The fork now has 31 audits in the `seo-extended` category. QA record:
  `docs/qa/robots-txt-sitemap.md` (items 1-3), `docs/qa/sitemap-fetch-and-parse.md` (sitemap work, items
  5, 8, 10, the private-network opt-in and the time budget), `docs/qa/sitemap-indexability.md`.
- **Real defects the audits found in real sites' own files during QA**: nodejs.org's sitemap lists URLs
  with the dots stripped (404); MDN's sitemap lists a duplicate URL and a `noindex` page.
- **Pipeline used**: `sitemap-fetch-and-parse` (the shared gatherer) and `sitemap-indexability` (the shared
  page sample and the refactor of a merged audit) ran the full 9-stage pipeline; the rest were lightweight
  or design-conversation-then-lightweight, per `.ai-agents/prompts/build-mode-selection.md`.
- **Security**: no `critical`/`high`/`medium`/`low` finding is open. Findings 1-6 and the follow-ups are
  in `.ai-agents/state/security-findings.md` with their resolving commits. Parser and fetch limits are
  documented in `packages/seo-audits/README.md`.
- **Tests**: 816 seo-audits tests pass, also under Node 18.20.8 (what CI pins); repo-wide typecheck and
  lint are clean. **Not confirmed**: the 12 failing suites in a full `npm run test` (mostly Storybook/
  Puppeteer image tests in `packages/server`) have never been compared with the base branch; it is the
  one open item in `.ai-agents/state/ci-backlog.md`. This phase changed nothing outside
  `packages/seo-audits` apart from docs and pipeline state.
- **Branch**: `phase-4-robots-sitemap` was 63 commits ahead of `main` before this closing record. It was **merged into `main`**
  with `--ff-only` (tip `d81c198`, 2026-10-01) and deleted, per `AGENTS.md`.
