# Phase 4 — Robots.txt & Sitemap

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-4-robots-sitemap` (off
`main`), the third phase to use the phase-branch workflow in `AGENTS.md`. Merges into `main` only
once every item is done, deferred, to-do-later, or marked not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

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
| 9 | Sitemap vs indexability conflict | planned (design settled 2026-09-30) | Full pipeline for the gatherer (new capability: bounded HTML read). One new gatherer requests each sampled sitemap URL once, reading status, headers and only the first ~64 KiB of HTML; `sitemap-url-status` is refactored to read it (same results and bounds, no extra requests), and a new audit flags **noindex** (X-Robots-Tag or meta robots) and **canonical pointing elsewhere** on a listed URL. Blocked-by-robots.txt is not repeated here (item 8). |
| 10 | `llms.txt` presence/validity | **done** (design settled 2026-09-30) | `llms-txt-structure`, lightweight mode; QA'd live against Stripe, Anthropic, nodejs.org and llmstxt.org, see `docs/qa/sitemap-fetch-and-parse.md`. Scored on **structure when present**: absent is not-applicable (the file is optional and only a proposal, llmstxt.org, Jeremy Howard, Sept 2024; not verified that any major search engine uses it, and the audit must say so, not imply SEO value). Present but invalid fails, but only on unambiguous violations (no H1, HTML served instead of markdown, a broken or empty link, an unsupported scheme); stylistic deviations real files use (plain items, sub-bullets, prose links) are notes, tuned against real files. Fetched through `safe-fetch.js` at the page origin's `/llms.txt`. |

## Deferred

| Item | Deferred | Why |
|---|---|---|
| 10 (llms.txt) | Checking that the links inside llms.txt resolve, `llms-full.txt`, and `llms.txt` at a subpath | The spec mentions none of the first two; the structure check is what was chosen. Reachability would reuse the bounded status check and can be added later without changing the audit's contract. |

## To do later

| Item | Basic version built | Advanced alternative, not built | Why not built now |
|---|---|---|---|
| 3 (robots-txt-rule-conflicts) | Identical path strings only | Wildcard/`$` overlap detection (`/a*` vs `/ab`) | Needs a pattern-intersection routine; the exact-match case is the common real mistake |

## Not possible / permanently out of scope

*(none yet)*
