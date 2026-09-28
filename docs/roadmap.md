# SEO audits roadmap

Tracks what's actually built vs planned for `packages/seo-audits`, across all feature areas — not
just structured data. Update this whenever a feature closes (stage `09-changelog-complete` in
`.ai-agents/state/current-feature.md`) or a new area gets broken down into features.

Status values: **done** (merged + QA'd live, not just unit-tested) · **in progress** · **planned** ·
**deferred** (deliberately not scoped yet, with a reason).

## Structured data

The original ask was one big "structured data" feature; broken down into six pieces of very
different size/risk during planning on 2026-09-28.

**Architecture pivot (2026-09-28)**: feature #2 was originally speced with rules hardcoded into the
audit. Before building it, we discussed the right architecture and decided to build a small versioned
rule registry/engine foundation first, then populate it with feature #2's content as data instead of
code. Full reasoning: `docs/architecture/structured-data-rule-engine.md`. Feature #2 is **paused**,
superseded by the new foundational feature below — its intake spec still documents the desired
property-validation behavior and stays as reference for the rule-engine feature to consume.

| # | Feature | Status | Slug / spec |
|---|---------|--------|--------------|
| 0 | JSON-LD parsing, JSON validity, `@context`/`@type` presence | **done** | `structured-data-validation` — `docs/feature-specs/structured-data-validation.md` |
| — | **Structured-data rule engine** (versioned registry + engine; also builds the real `structured-data-schema-properties` audit, scoped to `Product`+`Article`, and migrates `structured-data-json-ld` onto it) | **done** | `structured-data-rule-engine` — `docs/feature-specs/structured-data-rule-engine.md`, QA'd live `docs/qa/structured-data-rule-engine.md` |
| 1 | Rich-result type detection (Article, Product, FAQ, HowTo, BreadcrumbList, Recipe, Review, Event, JobPosting, VideoObject, Organization, LocalBusiness) | planned | engine now available — this is mostly a report-formatting feature over data the engine already resolves |
| 2 | Required/recommended property validation per schema type — remaining 10 types (`Product`+`Article` shipped by the rule-engine feature above) | planned, **ruleset-data-only** — no new audit code needed, just additions to `rules/google/structured-data/{version}.json` and `rules/eligibility/{version}.json` (next version after `2026-09`) | `structured-data-schema-properties` — `docs/feature-specs/structured-data-schema-properties.md` (original full-scope reference spec) |
| 3 | Duplicate/conflicting `@type` detection | planned | depends on #1 existing first |
| 4 | Cross-check structured data claims against visible page content (spam/policy risk detection) | deferred | fundamentally different kind of check (DOM-content comparison, real false-positive risk); needs its own careful spec, not bundled with the others |
| 5 | Match Google's Rich Results Test rules exactly | deferred | Google's Rich Results Test is a closed validator, not a published spec — true parity isn't realistic. #2 (using Google's own published per-type guidelines) gets most of the practical value instead |
| 6 | Microdata/RDFa support | deferred | separate markup format from JSON-LD, needs its own gatherer; JSON-LD is what Google actually recommends and what's dominant in practice — revisit only if a specific site needs it |
| — | Automated Google-doc change detection, LLM-assisted rule extraction, autonomous rule publishing | **do not build yet** (detection/extraction: build later, once rule engine has run in practice; autonomous publishing: real no for now) | `docs/architecture/structured-data-rule-engine.md` |

## Other audit areas

Not yet broken down — the original ask ("more auditing, especially in SEO") mentioned this is one of
several areas. Add sections here as they get planned.

## Closed, no build needed

| Feature | Reason | Spec |
|---|---|---|
| Missing/empty meta description audit | Already fully covered by Lighthouse core's `meta-description` audit, already enforced in this fork's `all`/`recommended` presets — nothing to build | `docs/feature-specs/missing-meta-description.md` |

## Pipeline itself

- `.ai-agents/` scaffold: built 2026-09-27, refined once after the first full run (stale diff range,
  Agent 05 folded into Gate 3, "merged ≠ done" made explicit, Lighthouse type/module boundaries
  codified into `lighthouse-conventions.md`). See `AGENTS.md`.
