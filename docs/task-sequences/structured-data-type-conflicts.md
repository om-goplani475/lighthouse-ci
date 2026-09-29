# Task sequence: Duplicate and Conflicting `@type` Detection

- slug: structured-data-type-conflicts

Every task's `scope_whitelist` stays inside `packages/seo-audits`. **One task (task-03) modifies
`rule-engine/registry.js`**, an existing shared file three already-shipped audits depend on —
flagged as higher-risk per `.ai-agents/prompts/monorepo-rules.md`, Step 2, even though it's still
inside `packages/seo-audits`: the change is additive-only (one new exported function, confirmed in
the contract's consistency check), but Agent 04 must run the *full* `seo-audits` test suite after
this task, not just the new test files, to prove the three existing audits are unaffected — this is
called out explicitly in that task's description, not left implicit.

Order follows this package's established pattern for a new rule-engine namespace (mirrors
`structured-data-rule-engine`'s task sequence): types → schema → registry → engine → ruleset data →
engine/registry tests → audit → fixture tests → config wiring → docs.

## Tasks

### task-01: `type-conflicts` typedefs (additive)

- scope_whitelist: [packages/seo-audits/src/rule-engine/types.js]
- depends_on: none
- description: Extend `FindingNamespace` to `'schema-org' | 'google-requirements' | 'eligibility' |
  'duplicate-count' | 'conflicting-entity'` (additive union member, not a replacement — confirm the
  three existing values are untouched). Add `TypeConflictsRuleSet` typedef
  (`{version: string, singularTypes: string[], identityFields: Record<string, string[]>}`) per the
  contract.
- commit_message: "feat(seo-audits): add type-conflicts typedefs"

### task-02: `type-conflicts` ruleset JSON Schema

- scope_whitelist: [packages/seo-audits/rules/schema/type-conflicts-ruleset.schema.json]
- depends_on: task-01
- description: JSON Schema (draft-07, `additionalProperties: false`, matching the style of the three
  existing schema files) validating `TypeConflictsRuleSet`'s shape from task-01 exactly —
  `version`, `singularTypes` (array of strings), `identityFields` (object, values are arrays of
  strings).
- commit_message: "feat(seo-audits): add type-conflicts ruleset JSON schema"

### task-03: Registry — add `resolveTypeConflictsRuleset()` (touches shared file — see note above)

- scope_whitelist: [packages/seo-audits/src/rule-engine/registry.js]
- depends_on: task-02
- description: Add `resolveTypeConflictsRuleset(versionOrCurrent = 'current')`, calling the existing
  `resolveRuleset()` with `rules/type-conflicts` and the task-02 schema path — exact same pattern as
  the three existing `resolve*Ruleset` functions, copy the structure, don't reinvent it. **Do not
  modify `resolveRuleset()`, `readJson()`, `readCurrentVersion()`, or any of the three existing
  `resolve*Ruleset` functions** — this task is purely additive. After this task's own
  typecheck/lint/unit-test loop, additionally run the full `packages/seo-audits` test suite (not
  just the affected paths) before committing — `registry.js` is imported, directly or transitively,
  by all three already-shipped audits' tests, and this is the one task in this feature where a
  mistake could silently regress them.
- commit_message: "feat(seo-audits): add resolveTypeConflictsRuleset to the rule registry"

### task-04: `type-conflicts-engine.js` — `findDuplicates` and `findConflicts`

- scope_whitelist: [packages/seo-audits/src/rule-engine/type-conflicts-engine.js]
- depends_on: task-01
- description: Two pure functions per the audit spec, no file I/O:
  - `findDuplicates(typeCounts, ruleset)` — `typeCounts` is a plain `Record<string, number>` (or
    `Map`, match whatever shape is most convenient for the audit to build; document the choice in
    the function's JSDoc). For each `type` in `ruleset.singularTypes` where `typeCounts[type] > 1`,
    return a `Finding` (`namespace: 'duplicate-count'`, `severity: 'error'`, `type`, `property: ''`,
    message naming the type and count).
  - `findConflicts(parsedBlocksByType, ruleset)` — `parsedBlocksByType` maps type to an array of
    parsed JSON-LD objects of that type. For each type with a `ruleset.identityFields` entry: group
    blocks by the first identity field (in the ruleset's listed order) each block has a truthy value
    for; blocks matching none of the listed fields are excluded from grouping entirely (never a
    wildcard match — this is the Gate-0-decided "strong identity fields only" behavior, get this
    exactly right, it's the feature's core risk control). Within each group of 2+ blocks, compare
    all other top-level keys (excluding `@context`, `@type`, and the matched identity field) —  for
    each key that differs in value across the group, return one `Finding`
    (`namespace: 'conflicting-entity'`, `severity: 'info'`, `type`, `property: <the differing key>`,
    message naming both differing values). Top-level comparison only, no recursion into nested
    objects.
- commit_message: "feat(seo-audits): add type-conflicts rule engine"

### task-05: Ruleset data — `type-conflicts` namespace

- scope_whitelist: [packages/seo-audits/rules/type-conflicts/*.json]
- depends_on: task-02
- description: `2026-10.json` + `current.json`, with the exact content from the audit spec:
  `singularTypes: ["Organization", "WebSite", "BreadcrumbList"]`, and the 8-type `identityFields`
  map (`Product`, `Organization`, `LocalBusiness`, `Event`, `VideoObject`, `Recipe`, `Article`,
  `JobPosting` — with `Product`'s multi-field list and `url` as the common fallback per type). No
  entries for `Review`/`FAQPage`/`HowTo`/`BreadcrumbList` in `identityFields` — confirm this is a
  deliberate omission, not forgotten (`BreadcrumbList` appears in `singularTypes` but *not*
  `identityFields` — it's checked for duplicate count, never for entity conflicts; don't conflate
  the two lists).
- commit_message: "feat(seo-audits): add v1 type-conflicts ruleset data"

### task-06: Engine and registry unit tests

- scope_whitelist: [packages/seo-audits/test/rule-engine/type-conflicts-engine.test.js, packages/seo-audits/test/rule-engine/registry.test.js]
- depends_on: task-03, task-04, task-05
- description: New `type-conflicts-engine.test.js` — `findDuplicates` (a singular type appearing
  twice fails, appearing once or zero times doesn't; a non-singular type appearing many times is
  never flagged) and `findConflicts` (two `Product` blocks sharing `sku` with a differing `price` →
  one finding naming `price`; two blocks with *different* `sku` values → no finding, even if other
  fields match; a block with no identity field present → excluded from any group, never flagged
  even if its other fields happen to match another block's — this is the single most important test
  in this feature, it's the concrete proof the "strong identity fields only" decision actually
  holds). Extend the existing `registry.test.js`'s production-ruleset-resolution test to also assert
  `resolveTypeConflictsRuleset()` resolves the real `2026-10.json` correctly, and confirm the
  existing "every checked-in ruleset file validates against its own schema" test picks up the new
  `type-conflicts/` directory automatically (it's generic/`readdirSync`-based, so this should need no
  code change — verify, don't assume, same lesson from the last feature).
- commit_message: "test(seo-audits): add type-conflicts engine and registry tests"

### task-07: New audit — `structured-data-type-conflicts`

- scope_whitelist: [packages/seo-audits/src/audits/structured-data-type-conflicts.js]
- depends_on: task-03, task-04, task-05
- description: Per the audit spec — parse each `StructuredDataJsonLd` block (reuse the
  `isObject`/`tryParse` helper pattern already established in the sibling audits, don't reinvent);
  build the type→count and type→parsed-blocks groupings the two engine functions need; call
  `findDuplicates` and `findConflicts`; `score = Number(duplicateFindings.length === 0)`;
  `{score: null, notApplicable: true}` only when there are zero blocks of any singular type AND zero
  blocks of any identity-field-bearing type. Table columns `namespace, type, detail, message` per
  the audit spec. Stamp `details.rulesetVersions = {typeConflicts: ruleset.version}`. Standard
  `@ts-expect-error` boundary comments, copied from the existing audits' established wording.
- commit_message: "feat(seo-audits): add structured-data-type-conflicts audit"

### task-08: Fixture tests for the new audit

- scope_whitelist: [packages/seo-audits/test/audits/structured-data-type-conflicts.test.js]
- depends_on: task-07
- description: Same shell-out-via-temp-files pattern as the other audits (transitively imports
  `registry.js`). Cover: clean page (no duplicates, no conflicts) → score 1; two `Organization`
  blocks → score 0, `duplicate-count` finding naming the count; two `Product` blocks sharing `sku`
  with differing `price` → score 1 (conflicts never affect score) but a `conflicting-entity` row
  present naming `price` and both values; two `Product` blocks with *different* `sku` → score 1, no
  conflict row (legitimately different entities — a product listing page, the exact case the audit
  spec calls out as what must NOT be flagged); a block with no identity field → never appears in any
  conflict grouping even when another block's other fields coincidentally match; not-applicable case
  (no singular-type or identity-bearing blocks at all).
- commit_message: "test(seo-audits): add fixture tests for structured-data-type-conflicts"

### task-09: Wire into custom Lighthouse config + regression test

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-07
- description: Add `'./audits/structured-data-type-conflicts.js'` to `audits` and
  `{id: 'structured-data-type-conflicts', weight: 1}` to `categories['seo-extended'].auditRefs`.
  Extend the regression test to assert all **four** structured-data audits present, `extends`
  preserved.
- commit_message: "feat(seo-audits): register structured-data-type-conflicts in the custom lighthouse config"

### task-10: Package README update

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-08, task-09
- description: Document the new audit alongside the existing three — what `duplicate-count` and
  `conflicting-entity` each check, that only `duplicate-count` affects score, the "strong identity
  fields only" behavior (a block with no identity field is never compared, so this audit will miss
  conflicts it has no reliable signal for — a deliberate false-negative bias over a false-positive
  one, worth stating explicitly), and which types are in `singularTypes` vs `identityFields` (they're
  different lists, `BreadcrumbList` is in one but not the other).
- commit_message: "docs(seo-audits): document structured-data-type-conflicts in the package README"
