# Feature: Structured Data (JSON-LD) Validation Audit

- slug: structured-data-validation
- requested: 2026-09-27
- type: new-audit

## Summary

A new SEO audit in `packages/seo-audits` that automatically validates JSON-LD structured data on a
page — something Lighthouse's own `structured-data` audit does not do (it's a manual-only placeholder
that just tells the user to run an external tool; see `docs/audit-specs/` note below). This audit
checks every `<script type="application/ld+json">` block on the page for valid JSON and the presence
of `@context`/`@type` fields.

## Concrete pass/fail example

- **Pass**: page has one `<script type="application/ld+json">` block containing
  `{"@context": "https://schema.org", "@type": "Article", "headline": "..."}` — valid JSON, both
  required fields present.
- **Fail (missing)**: page has no `<script type="application/ld+json">` block at all.
- **Fail (malformed JSON)**: a block's content fails `JSON.parse()` (e.g. trailing comma, unquoted
  key).
- **Fail (missing required fields)**: a block is valid JSON but lacks `@context` or `@type`.
- **Multiple blocks**: every block on the page is checked independently; the audit fails if *any*
  block is invalid, and the report details table lists each block's individual pass/fail state (not
  just an aggregate pass/fail) so a developer can see exactly which block to fix.

## Gatherer needs

- New gatherer required: **likely yes — to be confirmed by Agent 01's upstream-sync check**. Lighthouse
  has no existing gatherer that extracts `<script type="application/ld+json">` contents (only
  `MetaElements`, which covers `<meta>` tags, not `<script>` tags). Agent 01 should confirm this gap
  during `/design-audit` rather than assume.

## Scope

- Package(s) affected: `packages/seo-audits`
- Out of scope (explicitly, not just unmentioned):
  - Full schema.org type-specific validation (e.g. checking that a `Product` type has `price` and
    `availability`) — deliberately deferred; this feature only validates JSON structure and the two
    universal required fields (`@context`, `@type`), not per-type schema.org semantics.
  - Microdata or RDFa structured data formats — JSON-LD only for this feature.
  - Any live/external validation against Google's Rich Results Test or schema.org's own validator —
    this audit is self-contained and offline, per this repo's testing conventions.

## Open questions

None — both open questions from intake (validation depth, multiple-block handling) were resolved
before this spec was written: validate JSON + `@context`/`@type` presence; check every block
independently and report each in the details table.
