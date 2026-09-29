# Feature contract: Duplicate and Conflicting `@type` Detection

- slug: structured-data-type-conflicts

## TypeScript types

```js
// packages/seo-audits/src/rule-engine/types.js — additive changes only

/**
 * @typedef {'schema-org' | 'google-requirements' | 'eligibility' | 'duplicate-count' |
 *   'conflicting-entity'} FindingNamespace
 */
// FindingSeverity, Finding unchanged — the two new namespaces reuse the existing Finding shape
// exactly (duplicate-count uses severity: 'error', conflicting-entity uses severity: 'info',
// same as eligibility's existing informational convention).

/**
 * @typedef {{
 *   version: string,
 *   singularTypes: string[],
 *   identityFields: Record<string, string[]>,
 * }} TypeConflictsRuleSet
 */
```

```js
// packages/seo-audits/src/audits/structured-data-type-conflicts.js — audit-local, not in
// rule-engine/types.js (matches the established convention: audit-specific report row shapes
// stay local to the audit file, e.g. structured-data-rich-result-eligibility.js's
// EligibilitySummaryRow)

/**
 * @typedef {{
 *   namespace: 'duplicate-count' | 'conflicting-entity',
 *   type: string,
 *   detail: string,
 *   message: string,
 * }} TypeConflictRow
 */
```

## `.lighthouserc.js` config additions

**None.** Same as all three existing structured-data audits — rides the existing `configPath`
mechanism. No new config schema.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a — not part of shared presets |
| lighthouse:all | n/a — not part of shared presets |
| (fork preset) | n/a — not part of shared presets |

Not added to `recommended.js`/`all.js` — same reasoning as all three existing audits (opt-in via
`configPath`, `packages/utils/test/presets.test.js` would fail otherwise). Consumer sets severity in
their own `.lighthouserc.js`, per `.ai-agents/prompts/ci-assertion-presets.md`. Unlike
`structured-data-rich-result-eligibility`, this audit **does** have a real scored component
(`duplicate-count` findings), so a `minScore` assertion on it is meaningful — no assertion-hazard
note needed here, but Agent 06 should still verify live (learned from the last feature: don't trust
this claim unverified) that `lhci assert` behaves as expected for both a clean page and a page with
a real duplicate.

## Public exports

**No new dependency.** New files, all within `packages/seo-audits`:
- `packages/seo-audits/rules/type-conflicts/{version}.json` + `current.json` (new namespace,
  fourth alongside `schema-org`/`google`/`eligibility`)
- `packages/seo-audits/rules/schema/type-conflicts-ruleset.schema.json` (new JSON Schema)
- `packages/seo-audits/src/rule-engine/type-conflicts-engine.js` (new, `findDuplicates`/
  `findConflicts`)
- `packages/seo-audits/src/rule-engine/registry.js` — **modified**, adds
  `resolveTypeConflictsRuleset()` alongside the three existing `resolve*Ruleset` exports (additive
  function, no change to existing exports' behavior or signatures)
- `packages/seo-audits/src/rule-engine/types.js` — **modified**, additive typedef changes only (see
  above)
- `packages/seo-audits/src/audits/structured-data-type-conflicts.js` (new audit)
- `packages/seo-audits/src/lighthouse-config.js` — registers the new audit + category ref
- Test files under `packages/seo-audits/test/rule-engine/` and `test/audits/` (new)
- `packages/seo-audits/README.md` — documents the new audit

`packages/cli` still never imports `@lhci/seo-audits` directly — unchanged pattern.

## Consistency check

Cross-checked against `docs/audit-specs/structured-data-type-conflicts.md`:

- `TypeConflictsRuleSet`'s `singularTypes`/`identityFields` fields match the audit spec's v1
  ruleset content example exactly (`Organization`/`WebSite`/`BreadcrumbList` for singular types;
  the 8-type `identityFields` map with `Product`'s multi-field list and `url` as the common
  fallback).
- The two-namespace `FindingNamespace` addition (`duplicate-count`/`conflicting-entity`) matches the
  audit spec's explicit statement that these get different severities (`error` vs `info`) and must
  stay visually distinct in the report, same pattern as the existing `google-requirements`/
  `eligibility` split in `structured-data-schema-properties`.
- `registry.js`'s modification is additive-only (one new exported function) — confirmed this doesn't
  change any existing function's signature or behavior, so it carries no regression risk to the
  three already-shipped audits that import from it.
