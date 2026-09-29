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
| 1a | Title **and** meta description pixel-width truncation (real in-browser canvas measurement, not a character-count approximation) | **done** | `pixel-width-truncation` — `docs/feature-specs/pixel-width-truncation.md`, merged `5fea5d1` on this branch, QA'd live see `docs/qa/pixel-width-truncation.md`, security-reviewed see `.ai-agents/state/security-findings.md` (no findings). Decided at Gate 0 (2026-09-29): real canvas measurement over a character-count/static-font-table approximation — first new gatherer this repo has built since `structured-data-json-ld`'s, and the first gatherer to depend on the rule engine. Also decided at Gate 0: measure both title and description with one gatherer now (same underlying mechanism), rather than description-only with title as a separate follow-up — this is why item 2 below no longer includes pixel-width truncation, only its other checks. |
| 1b | Meta description identical/near-identical to page title | **done** | `meta-description-identical-to-title` — merged `7c9a948` on this branch, QA'd live see `docs/qa/meta-description-identical-to-title.md`. Built via a lightweight pass (no formal `.ai-agents/` design docs — spec/audit-spec/contract/task-sequence skipped by explicit developer request to cut token spend on simple, low-ambiguity single-page checks; scoring model and the near-identical heuristic were still confirmed with the developer via a blocking question first). Reuses the `PixelWidth` gatherer's artifact, no new gatherer. |
| 2 | Document title quality: missing/empty/invalid document title (pixel-width truncation moved into 1a, see above) | **done** | `document-title-quality` — merged `fa7bcaf` directly to this branch (no feature branch this time), QA'd live see `docs/qa/document-title-quality.md`. Missing/empty is already covered by Lighthouse core's `document-title` audit (axe's `doc-has-title` rule checks `!!document.title.trim()`) — confirmed by reading axe-core's source before building, same "check what's already covered" discipline as `missing-meta-description`, so this audit only covers "invalid": generic/placeholder title (fixed list), title too short (<10 chars), and multiple `<title>` elements (invalid markup) — scope confirmed with the developer via a blocking question first. Extends the `PixelWidth` gatherer's artifact with a `titleElementCount` field rather than adding a new gatherer. |
| 3 | Missing or multiple H1 elements; heading hierarchy validator (skipped levels, H1-vs-title relevance) | **done** | `document-h1-count` + `h1-title-relevance` — merged `3e180ac` directly to this branch, QA'd live see `docs/qa/h1-quality.md`. Skipped-heading-levels and empty-heading checks are already covered by Lighthouse core's `heading-order`/`empty-heading` accessibility audits (confirmed by reading axe-core's source), so this pass only covers H1 count (scored) and H1-vs-title relevance (informational only — a deliberately weak word-overlap heuristic, confirmed with the developer via a blocking question that this should never gate CI). New `Headings` gatherer (`h1Texts: string[]`). |
| 4 | Robots meta directive parser (`noindex`/`nofollow`/`none`/`nosnippet`/`noarchive`/`max-snippet`/`max-image-preview`/`max-video-preview`) with plain-English explanation of implications; `X-Robots-Tag` header parity/conflict check | **done** | `robots-directives-report` (informational, all directives + plain-English explanations) + `robots-directives-conflict` (scored, meta-vs-header indexability disagreement) — merged `d0ce06c` directly to this branch, QA'd live see `docs/qa/robots-and-canonical.md`. Core has zero robots-meta/`X-Robots-Tag` coverage (confirmed via grep), so fully additive. No new gatherer — reads core's `MetaElements` artifact and the main document's response headers via core's `MainResource` computed artifact (the same one core's own `canonical` audit uses). |
| 5 | Canonical quality: exists/absolute/HTTPS/points to 200 (not redirected/404/blocked); canonical conflicts (multiple canonicals, A→B→A chains) | **done** (basic scope) | `canonical-https` — merged `d0ce06c` directly to this branch, QA'd live see `docs/qa/robots-and-canonical.md`. Core's own `canonical` audit already covers presence, validity, absoluteness, multiple-conflicting-canonicals, hreflang mismatches, and the "points to domain root" mistake (confirmed by reading its full source) — this audit adds only the HTTPS check. The "points to 200"/A→B→A-chain checks need a new outbound-fetch capability with SSRF-prevention obligations; confirmed with the developer via a blocking question to build the basic (no-fetch) version now and record the advanced version below rather than build it in this pass. |
| 6 | Favicon presence + multi-size/manifest icon check | **done** | `favicon-presence` (scored) + `favicon-quality` (informational) + `manifest-icons` (scored, fetch-based) — merged `91dc05a` directly to this branch, QA'd live see `docs/qa/favicon-and-manifest.md`, security-reviewed see `.ai-agents/state/security-findings.md` (the first outbound-fetch capability this package has ever had — reviewed with real care, not lightweight-mode speed). Core has zero favicon/manifest coverage at all (confirmed — this Lighthouse version doesn't even have a `WebAppManifest` gatherer). Unlike item 5, the developer chose the **advanced** option here via blocking question: build the SSRF-protected manifest fetch now (`src/lib/safe-fetch.js`) rather than defer it — caught and fixed a real bypass (Node's http client skipping the custom DNS `lookup` for literal-IP URLs) before it ever shipped. New `FaviconLinks` gatherer. |

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

Advanced/harder alternatives to a basic version already built in this phase — recorded here per
the developer's explicit request (2026-09-29) to track this pattern for every feature going
forward: whenever a feature has a "basic" and an "advanced" option and the basic one is what got
built, the advanced one is noted here rather than silently dropped.

| Item | Basic version built | Advanced alternative, not built | Why not built now |
|---|---|---|---|
| 5 (canonical) | `canonical-https` — HTTPS scheme check only, no network fetch | Fetch the canonical URL and confirm it resolves to a real 200 page (not redirected/404/blocked); chase canonical chains (A→B→A) | Needs a new outbound-fetch capability this package has never had, with real SSRF-prevention obligations (block private/reserved IPs and the cloud metadata address after DNS resolution, restrict to http/https schemes, bound request count and timeout — see `.ai-agents/prompts/security-checklist.md`) and a dedicated security review. Confirmed via blocking question (2026-09-29) to defer rather than build in the same lightweight pass as everything else this phase. |
| 1b (meta-description-identical-to-title) | Length-ratio + substring-containment heuristic (≥50% of the longer string, fully contained) for "near-identical" | Fuzzy/edit-distance matching (e.g. Levenshtein) for near-identical detection, which could catch near-identical descriptions that aren't a clean substring match (e.g. reordered words, minor rewording) | Not requested or needed yet — the substring heuristic already catches the concrete case the feature exists for (title + site-name suffix). No known false-negative pattern in practice to justify the added complexity of a fuzzy-matching dependency. |
| 2 (document-title-quality) | Generic/placeholder title matched against a fixed, hand-curated list (exact match after normalizing) | Broader pattern-based or NLP-based genericness detection (e.g. flag any title that's just a single common noun, or use a language model to judge genericness) | The fixed list has zero false-positive risk by construction (only matches known template defaults); a broader heuristic would trade that certainty for recall at real false-positive cost. Revisit only if the fixed list proves too narrow in practice. |
| 3 (h1-title-relevance) | Word-overlap heuristic (≥1 shared significant word, ≥3 chars, stopwords excluded) | Semantic similarity (embeddings/NLP) instead of literal word overlap — would catch a genuinely relevant H1 that shares zero literal words with its title (synonyms, rephrasing), which the current heuristic cannot and explicitly documents as a known limitation | Confirmed via blocking question (2026-09-29) to build the weak, purely informational heuristic now rather than take on an NLP dependency for a check that already carries an explicit "don't trust this as evidence" caveat in its own `description` string. No known user need to revisit yet. |

## Sequencing note

Per `docs/master-roadmap.md`'s "suggested build order" (both source lists agreed on this shape):
meta description → document title → H1 → robots meta → canonical. Favicon wasn't ranked by either
list; it's the smallest/lowest-priority item here, reasonable to do last.
