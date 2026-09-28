# Feature: Remaining Rich-Result Types for Schema Property Validation

- slug: structured-data-remaining-types
- requested: 2026-09-28
- type: tooling

## Summary

Extends the `structured-data-schema-properties` audit (shipped by `structured-data-rule-engine`,
2026-09-28) to cover the remaining 10 rich-result-eligible types: `FAQPage`, `HowTo`,
`BreadcrumbList`, `Recipe`, `Review`, `Event`, `JobPosting`, `VideoObject`, `Organization`,
`LocalBusiness`. `Article` and `Product` are already shipped. This is **not** a new audit and
**not** a code change to `structured-data-schema-properties.js` — that audit already keys its
type-tracking off `googleRuleset.types[schemaType]` dynamically
(`packages/seo-audits/src/audits/structured-data-schema-properties.js:83`), so adding a type is
purely a matter of adding entries to the two versioned ruleset data files:
`rules/google/structured-data/{version}.json` (required/recommended properties, drives score) and
`rules/eligibility/{version}.json` (informational rich-result-support hedge, never affects score).
Confirmed by reading the audit and both engines — no `if (type === 'Product')`-style branching
exists anywhere in the code path.

## Concrete pass/fail example

Same pattern as the shipped `Article`/`Product` behavior, extended to the new types:

- **Pass**: a JSON-LD block with `@type: "Recipe"` includes every property the new
  `Recipe` entry in `rules/google/structured-data/{version}.json` lists (e.g. `name`, `image`,
  and the nested `nutrition` sub-object's required properties, per the same nested-path pattern
  `Product.offers` already established) — audit scores 1 for that block.
- **Fail**: a `@type: "JobPosting"` block is missing a listed property (e.g. `datePosted`) —
  audit fails, report names the exact missing property, same as the `Product`/`Article` case.
- **Not applicable**: unchanged — a page with no JSON-LD, or JSON-LD whose `@type` values are
  none of the (now 12) tracked types, scores `null`/not-applicable.
- **Regression check**: `Article` and `Product` behavior must be byte-for-byte unchanged — this
  feature only adds new keys to the ruleset JSON, never touches the `Article`/`Product` entries.

## Severity model

Unchanged from the original intake decision (`docs/feature-specs/structured-data-schema-properties.md`):
required and recommended properties are not distinguished — both treated as required, one severity.

## Nesting

Unchanged approach: only specific, well-known nested sub-object paths get checked per type (the
`Product.offers`/`Product.aggregateRating` pattern), not generic recursive validation. Which of the
10 new types actually need a nested path (e.g. `Recipe.nutrition`, `Event.offers`,
`JobPosting.hiringOrganization`) is authored per type from Google's published guidelines during
implementation — this spec doesn't enumerate them per-type; that's Agent 01/02 territory (matches
how `Product.offers` was handled in the rule-engine feature, not re-litigated here).

## Gatherer needs

- New gatherer required: **no**.
- New audit code required: **no**.
- New engine/registry code required: **no**. This feature is scoped to reuse
  `google-requirements-engine.js`, `eligibility-engine.js`, and `registry.js` exactly as they
  exist today — confirmed capable of handling arbitrary types generically, not just `Product`
  and `Article`, by reading `google-requirements-engine.js`'s `validate()` and
  `eligibility-engine.js`'s `evaluate()` (both take `schemaType` as a parameter and look it up in
  the ruleset object; no type-specific branching in either file).
- Existing gatherer providing the data: `StructuredDataJsonLd`
  (`packages/seo-audits/src/gatherers/structured-data-json-ld.js`).

## Scope

- Package(s) affected: `packages/seo-audits` — specifically only
  `rules/google/structured-data/{new-version}.json`, `rules/eligibility/{new-version}.json`, and
  each namespace's `current.json` manifest (bumped to point at the new version). No `src/` changes
  expected unless design review finds an engine gap for a specific type's shape.
- New ruleset version: next calendar version after `2026-09` (exact date TBD at implementation
  time), per the rule engine's versioning convention
  (`docs/architecture/structured-data-rule-engine.md`).
- Out of scope (unchanged from the original intake, still applies):
  - Rich-result type *detection* as a standalone report (roadmap feature #1).
  - Duplicate/conflicting `@type` detection (roadmap feature #3).
  - Cross-checking schema claims against visible page content (roadmap feature #4).
  - Exact parity with Google's Rich Results Test tool (roadmap feature #5).
  - Microdata/RDFa (roadmap feature #6).
  - Generic/arbitrary nested schema validation beyond documented per-type nested paths.
  - Any change to `Article`/`Product` ruleset entries — additive only.

## Open questions (for Agent 01/02 to resolve during design)

- **Reference data source and drift risk**: same caveat as the original intake — property lists
  are authored from Google's published guidelines as currently known, no live fetch. 10 types is
  more surface for this drift risk than the 2 already shipped; worth Agent 01 re-flagging in the
  audit spec, not assuming the original note covers it.
- **Task sequencing size**: 10 types, several with nested sub-objects, plus their eligibility
  entries — Agent 03 should split by type or small type-groups (2-3 per task), same pattern used
  for the rule-engine feature's task sequence, so commits stay atomic and reviewable. Likely
  larger than any single feature built through this pipeline so far in task count.
- **Per-type nested-path list**: which of the 10 types need a nested sub-object check (vs a flat
  property list like `Article`) isn't decided here — Agent 01 should enumerate this per type in
  the audit spec, following the same judgment call the rule-engine feature made for
  `Product.offers`/`Product.aggregateRating`.
- **Schema validity vs Google-requirements distinction for new types**: confirm each new type is
  a real schema.org type (for the separate `schema-org` namespace/`structured-data-json-ld` audit,
  unaffected by this feature) before adding it to the Google-requirements ruleset — should already
  be true since these 10 were named in the original intake's tracked-type list, but worth a quick
  sanity check per type during design, not assumed.
