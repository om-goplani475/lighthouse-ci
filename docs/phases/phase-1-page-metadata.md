# Phase 1 — Page-Level Metadata

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-1-page-metadata`
(off `main`, opened 2026-09-29 — the first phase to use the phase-branch workflow documented in
`AGENTS.md`'s "Phase branches" section). Every feature in this phase runs the normal 9-stage
pipeline, `feat/{slug}` branching off `phase-1-page-metadata` and merging back into it; this branch
only merges into `main` once every item below is done, deferred, to-do-later, or marked not
possible — not on any earlier cadence.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

## A structural note before any feature starts here

Several items in this phase's original wishlist are **site-wide** (duplicate titles/descriptions
*across* pages, template-suffix pattern detection). A Lighthouse audit — the mechanism every
feature in this package has used so far — evaluates **one page at a time**; it has no way to
compare page A's title against page B's, because it never sees page B. Cross-page duplicate
detection needs a crawler/orchestration layer that doesn't exist anywhere in this repo yet (see
`docs/master-roadmap.md`'s Phase 16/31 — "Site Intelligence" / "Multi-page crawling
infrastructure", both explicitly not started). Those items are filed under "Not possible without
new infrastructure" below, not folded into the single-page features — this is a real, structural
limitation of the audit model itself, not a scoping choice that could go either way.

## Features

| # | Feature | Status | Slug / spec |
|---|---------|--------|--------------|
| 0 | Missing/empty/whitespace-only meta description | **closed, no build needed** | `missing-meta-description` — already fully covered by Lighthouse core's own `meta-description` audit, already enforced in this fork's `all`/`recommended` presets. See `docs/feature-specs/missing-meta-description.md` (built during an earlier phase, before this phase existed as a tracked unit). |
| 1a | Meta description pixel-width truncation (real in-browser canvas measurement, not a character-count approximation) | in progress | Decided at Gate 0 (2026-09-29) over the simpler character-count-approximation and static-font-metrics-table alternatives — first new gatherer this repo has built since `structured-data-json-ld`'s. Split out from the original roadmap item as its own feature since it's meaningfully higher-risk (new gatherer) than 1b. |
| 1b | Meta description identical/near-identical to page title | planned | single-page, no new gatherer — deliberately sequenced after 1a is designed, not built in parallel, so a smaller/lower-risk feature doesn't get stuck behind review of the bigger one, but its spec work can start once 1a's design is stable |
| 2 | Document title quality: missing/empty/invalid, length + pixel-width truncation | planned | single-page checks, buildable now |
| 3 | Missing or multiple H1 elements; heading hierarchy validator (skipped levels, H1-vs-title relevance) | planned | single-page checks, buildable now |
| 4 | Robots meta directive parser (`noindex`/`nofollow`/`none`/`nosnippet`/`noarchive`/`max-snippet`/`max-image-preview`/`max-video-preview`) with plain-English explanation of implications; `X-Robots-Tag` header parity/conflict check | planned | single-page checks, buildable now |
| 5 | Canonical quality: exists/absolute/HTTPS/points to 200 (not redirected/404/blocked); canonical conflicts (multiple canonicals, A→B→A chains) | planned | single-page checks, buildable now — note Lighthouse core's own `canonical` audit already covers basic presence/validity; this would need to confirm what's genuinely additive before design, same "check what's already covered" discipline as `missing-meta-description` |
| 6 | Favicon presence + multi-size/manifest icon check | planned | single-page check, buildable now |

## Not possible without new infrastructure

Not a prioritization choice — these need a crawler/multi-page orchestration layer this repo has
never built, tracked separately (Phase 16/31 in `docs/master-roadmap.md`), before they're even
buildable as a concept, regardless of how much time is spent on them.

| Item | Why | Reference |
|---|---|---|
| Duplicate/near-duplicate meta descriptions across site | Requires comparing values across multiple pages — a single-page Lighthouse audit structurally cannot see another page's content | `docs/master-roadmap.md` Phase 16/31 |
| Duplicate titles across site (incl. template-suffix pattern detection, e.g. "Home \| MyCompany") | Same structural limitation — needs a crawl step that aggregates titles across URLs before any comparison logic can run | `docs/master-roadmap.md` Phase 16/31 |

## Deferred

*(none yet — nothing in this phase has been evaluated and deliberately set aside; this section
exists for when that happens, per the phase-file convention in `AGENTS.md`)*

## To do later

*(none yet)*

## Sequencing note

Per `docs/master-roadmap.md`'s "suggested build order" (both source lists agreed on this shape):
meta description → document title → H1 → robots meta → canonical. Favicon wasn't ranked by either
list; it's the smallest/lowest-priority item here, reasonable to do last.
