# Feature: Structured Data Rule Engine (versioned registry + engine foundation)

- slug: structured-data-rule-engine
- requested: 2026-09-28
- type: new-audit (plus infrastructure + migration of an existing audit)

## Summary

Builds the versioned rule registry + rule engine foundation described in
`docs/architecture/structured-data-rule-engine.md`, proves it end-to-end against two schema types
(`Product`, `Article`), and migrates the existing `structured-data-json-ld` audit onto it. This
replaces feature #2's original hardcoded-rules approach (paused — see `docs/roadmap.md`) with rules
as versioned, external data. Once this exists, feature #2 resumes as *ruleset data additions* for the
remaining 10 types, not new audit code — the validator itself doesn't change again.

## Concrete scope, in three parts

**1. Engine + registry infrastructure** (`packages/seo-audits/src/rule-engine/`):
- `RuleEngine.validate(data, ruleset) → Finding[]` — pure function, no I/O.
- `RuleRegistry.resolve(version | 'current') → RuleSet` — the only code that reads `rules/`.
- Three separate namespaces, three separate rule files under `packages/seo-audits/rules/`:
  `schema-org/`, `google/structured-data/`, `eligibility/` — each versioned (`2026-09.json`,
  `current.json` manifest), per the data model in the architecture doc.
- A JSON Schema per namespace (`packages/seo-audits/rules/schema/*.schema.json`), validated in
  `npm run test:unit` — malformed ruleset files must fail CI, not just fail silently at runtime.
- `conditional` reserved in the Google-requirements schema shape from day one (per the architecture
  doc), even though neither `Product` nor `Article`'s v1 rules need to populate it.

**2. Ruleset content for exactly two types**: `Product` (proves the nested-required-sub-object case —
`offers` → `price`/`priceCurrency`/`availability`) and `Article` (proves the flat-required-properties
case, no nesting). Both go in a single initial version file per namespace, e.g. `2026-09.json`.

**3. Two audit-side changes**:
- **Migrate** `structured-data-json-ld` (already shipped, already live-tested) to call
  `RuleEngine.validate()` against the `schema-org` namespace for its existing check (JSON validity,
  `@context`/`@type` presence), instead of its current inline `JSON.parse` + field check. **Behavior
  must not change** — same pass/fail outcomes on every existing fixture and the live-verified cases
  from `docs/qa/structured-data-validation.md`. This is a refactor, not a feature change; treat it
  with the same care as touching any already-shipped audit.
- **Build** `structured-data-schema-properties` (the real audit from feature #2's original spec,
  scoped down to `Product` + `Article` only) — calls the engine's `google/structured-data` namespace
  for required-property validation and the `eligibility` namespace for rich-result-eligibility
  reporting, each as separate, clearly-labeled sections in the report (never merged into one finding
  list, per the three-namespace separation). Reuses the existing `StructuredDataJsonLd` gatherer — no
  new gatherer needed, same as feature #2's original spec established.

## Concrete pass/fail example

- **Engine**: `RuleEngine.validate({name: "x", image: "y"}, articleRuleset)` for `Article` (assume
  required: `headline`, `image`, `datePublished`) returns a `Finding` for the missing `headline` — a
  unit-testable, gatherer/audit-independent behavior.
- **Migrated audit**: identical to `structured-data-json-ld`'s existing documented pass/fail cases in
  `docs/feature-specs/structured-data-validation.md` — this feature must not change any of those
  outcomes, only how the check is implemented internally.
- **New audit, `Product`**: a block with `@type: "Product"` missing `offers.availability` fails, with
  the report distinguishing "Google requirement: offers.availability missing" from any eligibility
  finding, not blending them into one message.
- **New audit, `Article`**: a block with `@type: "Article"` missing `datePublished` fails, flat
  (non-nested) case.
- **Not applicable**: a page with no `Product`/`Article`-typed blocks (or no JSON-LD at all) scores
  `null`/not-applicable for `structured-data-schema-properties` — same "don't fail pages that have no
  reason to declare this type" rule established in feature #2's original spec.
- **Reproducibility**: both audits' results stamp `rulesetVersions` (per namespace) into their
  `details`/`debugdata` — re-running against an old LHR's stamped version should be able to reproduce
  the same finding, even after `current.json` has moved on to a later version.

## Gatherer needs

- New gatherer required: **no**. Both audits (the migrated one and the new one) consume the existing
  `StructuredDataJsonLd` gatherer's artifact.

## Scope

- Package(s) affected: `packages/seo-audits` only.
- Out of scope (explicitly):
  - The remaining 10 tracked types (`FAQPage`, `HowTo`, `BreadcrumbList`, `Recipe`, `Review`, `Event`,
    `JobPosting`, `VideoObject`, `Organization`, `LocalBusiness`) — follow-up work once this proves
    out, added as ruleset *data* to `google/structured-data/{version}.json` and `eligibility/{version}.json`,
    not new audit code. This is the whole point of building the engine first.
  - Any automated Google-documentation change detection, LLM-assisted rule extraction, or autonomous
    rule publishing — all explicitly deferred/do-not-build per `docs/architecture/structured-data-rule-engine.md`.
  - Conditional-requirement *logic* — the schema reserves the field, but no rule in this feature's
    scope actually uses it (neither `Product` nor `Article` needs it for their top-level + one-level
    nested requirements).

## Open questions (for Agent 01 to resolve during design)

- **Reference data source for `Product`/`Article` rules**: same drift-risk note as feature #2's
  original spec — authored from Google's published guidelines as currently known, not fetched live.
  This feature's whole point is making that driftable content *data*, not eliminating the drift risk
  itself (that's C/D territory, explicitly deferred).
- **Migration regression risk**: Agent 01/04 should identify the exact existing test/fixture coverage
  for `structured-data-json-ld` (unit tests in `packages/seo-audits/test/audits/`, plus the live
  `lhci collect`/`lhci assert` verification already recorded in `docs/qa/structured-data-validation.md`)
  and confirm all of it still passes unchanged after migration, before considering the migration task
  done.
- **Version identifier for the initial ruleset**: propose `2026-09` (matches current date) unless
  Agent 01 has a reason to pick differently.
