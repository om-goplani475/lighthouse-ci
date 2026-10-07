# Phase 3 — Social / Sharing Metadata

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-3-social-metadata` (off
`main`) — the second phase to use the phase-branch workflow documented in `AGENTS.md`'s "Phase
branches" section. This branch only merges into `main` once every item below is done, deferred,
to-do-later, or marked not possible — not on any earlier cadence.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

## Features

The original five-item wishlist was split at planning time (2026-09-30) by how concretely scoped
each item already was: four items were concrete/bounded enough to build directly (lightweight
mode — no formal `.ai-agents/` design docs); the fifth (social preview renderer) was a genuinely
different kind of feature — not a pass/fail or informational-table check like everything else in
this package — and got a short design conversation before any code, which surfaced a real
architectural constraint (see "Not possible" below) and reshaped what item 5 actually became.

**Status: Done. All five items resolved 2026-09-30; merged into `main`.**

| # | Feature | Status | Slug / spec |
|---|---------|--------|--------------|
| 1 | Open Graph completeness (`og:title`/`og:description`/`og:image`/`og:type`/`og:url`/`og:site_name`) | **done** | `open-graph-completeness`, QA'd live see `docs/qa/social-metadata.md`. No new gatherer — reads core's own `MetaElements` artifact. |
| 2 | `og:url` matches canonical | **done** | `open-graph-canonical-match`, QA'd live see `docs/qa/social-metadata.md`. Reads `MetaElements` + core's `LinkElements`. |
| 3 | `og:image` returns 200 | **done** | `open-graph-image-reachable`, QA'd live see `docs/qa/social-metadata.md`. Reuses `src/lib/safe-fetch.js`'s SSRF-protected request path via a new `safeFetchStatus` export (status-only, never downloads the image body). A real pre-existing bug in `safeLookup` (broke every real outbound fetch to a non-literal-IP hostname, including `manifest-icons`) was found and fixed during this item's live QA — see the QA doc. |
| 4 | Twitter/X Card (card type, title, description, image, image accessibility) | **done** | `twitter-card-completeness`, QA'd live see `docs/qa/social-metadata.md`. Sourcing caveat: X's official docs are largely paywalled/degraded, so what's checked is corroborated across secondary sources, not a single fetched authoritative page — stated plainly in the audit's own module doc. |
| 5 | Social preview renderer (show the actual link-card appearance) | **done** (scoped down) | `social-preview-content`, QA'd live see `docs/qa/social-metadata.md`. A true visual render is **not achievable** inside a standard Lighthouse report — confirmed by reading `node_modules/lighthouse/report/renderer/details-renderer.js`, whose `render()` hardcodes `details.type: 'screenshot'` as internal-only (the `final-screenshot` audit's own special-cased UI, not a generic per-audit image slot); no other `details` type can show a composed image either, and building one would mean editing `packages/viewer`, against this fork's own audit/gatherer boundary. Confirmed via blocking question to build a text-based preview-*content* report instead (title/description/image URL each platform would actually use, real fallback rules, not a picture) rather than file this as not-possible. Shares fallback-resolution logic with `twitter-card-completeness` via new `src/lib/social-meta.js`. |

## Sourcing note

Open Graph's actual required-vs-recommended property split is taken directly from the protocol
spec (`ogp.me`): four properties (`og:title`, `og:type`, `og:image`, `og:url`) are genuinely
required; `og:description`/`og:site_name`/`og:image:alt` are recommended, not required. The spec
states no minimum/recommended `og:image` pixel dimensions at all — so v1 deliberately does not
invent a pixel threshold to check `og:image` dimensions against (see "To do later" below).

Twitter/X Card's official developer docs are largely paywalled/degraded since the platform's
ownership change and could not be directly verified the way schema.org's pages were for Phase 2
item 6. What's used here (`twitter:card` is the only genuinely required tag; `twitter:title`/
`twitter:description`/`twitter:image` fall back to `og:title`/`og:description`/`og:image` when the
`twitter:`-specific tag is absent) is corroborated across multiple secondary sources but not a
single authoritative fetched page — stated plainly here, not buried, same hedging discipline as
`rules/serp-pixel-budgets/`'s unverified-approximation caveat.

## Deferred

*(none yet)*

## To do later

| Item | Basic version built | Advanced alternative, not built | Why not built now |
|---|---|---|---|
| 1 (open-graph-completeness) | Presence/structural checks only (required tags, recommended tags, `og:image:alt` recommendation) | Numeric `og:image` pixel-dimension/aspect-ratio thresholds | `ogp.me` states no official minimum or recommended dimensions — any numeric threshold would be an invented, unverified number (unlike `serp-pixel-budgets`, where inventing an approximate threshold was unavoidable to build the feature at all; here the core completeness check doesn't require one). Revisit only if a real, citable source for a dimension convention is found. |

## Not possible / permanently out of scope

| Item | Why | Reference |
|---|---|---|
| A true visual render of the social share preview card (item 5's original ask) | Lighthouse's own report renderer treats `details.type: 'screenshot'` as internal-only for the `final-screenshot` audit's special-cased UI, not a generic per-audit image slot — no `details` type can show a composed image. Building one would mean editing `packages/viewer`, which this fork's own rules say audit/gatherer work must not do. Real, standing architectural policy, not a scheduling choice — would need a deliberate decision to add a viewer-side rendering capability before this could be reconsidered | `docs/qa/social-metadata.md`, `src/audits/social-preview-content.js`'s module doc |
