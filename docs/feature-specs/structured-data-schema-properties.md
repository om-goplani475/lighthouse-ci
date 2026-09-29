# Feature: Required Schema Properties Per Rich-Result Type

- slug: structured-data-schema-properties
- requested: 2026-09-28
- type: new-audit

## Summary

A new SEO audit in `packages/seo-audits` that, for each JSON-LD block on a page whose `@type` is one
of 12 tracked rich-result-eligible types, validates that the properties Google's structured-data
guidelines call for (both required and recommended — treated as one severity, see below) are present,
including specific well-known nested sub-object properties (e.g. `Product.offers.price`). This is
feature #2 from the structured-data roadmap breakdown (`docs/phases/phase-2-structured-data.md`,
moved from `docs/roadmap.md` 2026-09-29) — it builds on the existing
`structured-data-json-ld` audit's JSON-LD parsing, but is a separate audit, not a change to it.

Tracked types (all 12, per the roadmap decision to cover the full list in v1): `Article`, `Product`,
`FAQPage`, `HowTo`, `BreadcrumbList`, `Recipe`, `Review`, `Event`, `JobPosting`, `VideoObject`,
`Organization`, `LocalBusiness`.

## Concrete pass/fail example

- **Pass**: a JSON-LD block with `@type: "Product"` includes `name`, `image`, `offers` (nested object
  with `price`, `priceCurrency`, `availability`) — all tracked properties for `Product` present.
- **Fail**: a `@type: "Product"` block is missing `offers.availability` — audit fails, report lists
  exactly which property is missing, on which type, in which block.
- **Not applicable (not fail)**: a page has no JSON-LD at all, or its JSON-LD blocks' `@type` values
  are none of the 12 tracked types (e.g. `@type: "WebSite"`, or a custom/unlisted type) — this audit
  scores `null`/not-applicable, not 0. It only evaluates pages that actually declare one of the 12
  tracked types; a page with no reason to have `Product` markup shouldn't fail a `Product` check.
- **Multiple blocks/types**: a page with both `@type: "Organization"` and `@type: "Article"` blocks —
  each tracked-type block is validated independently; the report lists results per block, not just
  one aggregate pass/fail (same per-block reporting pattern as `structured-data-json-ld`).
- **Malformed/unparseable block**: already handled by the existing `structured-data-json-ld` audit;
  this audit only evaluates blocks that parsed successfully. A block that fails to parse contributes
  nothing here (it's already flagged by the other audit).

## Severity model (per intake decision)

Required and recommended properties are **not distinguished** — both treated as required. Any missing
property (whether Google calls it required or recommended in its own docs) fails the audit for that
type/block. This is a deliberate simplification from Google's own two-tier model, chosen at intake.

## Nesting (per intake decision)

v1 follows into specific, well-known nested required sub-objects per type — e.g. `Product.offers`
(itself an `Offer`, with its own required `price`/`priceCurrency`/`availability`),
`Product.aggregateRating` (an `AggregateRating`, with `ratingValue`/`reviewCount`), `Recipe.nutrition`,
etc. This is **not** a generic recursive schema validator — only the specific nested paths documented
per type get checked, matching what Google's own per-type guidelines actually call out as nested
requirements.

## Gatherer needs

- New gatherer required: **no**. Reuses the existing `StructuredDataJsonLd` gatherer
  (`packages/seo-audits/src/gatherers/structured-data-json-ld.js`) — it already collects raw JSON-LD
  block text; this audit does deeper parsing of that same artifact, not new page data collection.

## Scope

- Package(s) affected: `packages/seo-audits`
- New audit, separate from `structured-data-json-ld` — not a modification of it. Both audits consume
  the same `StructuredDataJsonLd` gatherer artifact independently.
- Out of scope (explicitly):
  - Rich-result type *detection* as a standalone report (roadmap feature #1) — this feature only
    validates properties for types it recognizes; a separate, smaller feature can surface "here's
    what rich-result types this page is eligible for" as its own report, reusing the same type-lookup
    table this feature builds.
  - Duplicate/conflicting `@type` detection (roadmap feature #3).
  - Cross-checking schema claims against visible page content (roadmap feature #4) — deferred per
    roadmap, out of scope here.
  - Exact parity with Google's Rich Results Test tool (roadmap feature #5) — this audit approximates
    Google's *published* per-type guidelines, not the closed validator's exact behavior.
  - Microdata/RDFa (roadmap feature #6) — JSON-LD only.
  - Generic/arbitrary nested schema validation beyond the specific documented nested paths per type
    (see Nesting above).

## Open questions (for Agent 01 to resolve during design)

- **Reference data source and drift risk**: the required/recommended property lists per type will be
  authored from Google's published structured-data guidelines as currently known, not fetched live
  (no live internet access during implementation). This is a real, ongoing drift risk distinct from
  the existing `upstream-sync.md` check (which covers Lighthouse's own API, not Google's external
  documentation) — Google can and does revise these guidelines over time. Agent 01 should note this
  explicitly in the audit spec and flag it as a maintenance concern, not something this pipeline can
  self-verify the way it verifies against installed `lighthouse`.
- **Task sequencing size**: 12 types × required-property tables × some with nested sub-objects is
  substantially bigger than any feature built through this pipeline so far. Agent 03 should not
  sequence this as one or two tasks — split by type or small type-groups (e.g. 2-3 types per task) so
  commits stay atomic and reviewable, per this repo's "one task = one commit" rule.
- **Audit id**: proposed `structured-data-schema-properties` — Agent 01 should confirm this doesn't
  collide with anything in Lighthouse core or the existing `structured-data-json-ld` audit (it
  shouldn't, but verify per the upstream-sync check either way).
