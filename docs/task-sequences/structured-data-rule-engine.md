# Task sequence: Structured Data Rule Engine

- slug: structured-data-rule-engine

## Tasks

### task-01: Rule-engine types + `ajv` dependency

- scope_whitelist: [packages/seo-audits/package.json, packages/seo-audits/src/rule-engine/types.js]
- depends_on: none
- description: Add `ajv` as an explicit dependency in `packages/seo-audits/package.json` at `^6.12.6`
  (the version already resolvable in this repo's `node_modules` — do not bump to a newer major
  version; per the audit spec, confirm this doesn't conflict with anything else in the monorepo
  already depending on it transitively before committing). Run `yarn install` to link it. Write
  `src/rule-engine/types.js` with the JSDoc typedefs from `docs/feature-contracts/structured-data-rule-engine.md`
  (`Finding`, `SchemaOrgRuleSet`, `GoogleRequirementsRuleSet`, `EligibilityRuleSet`, etc.).
- commit_message: "feat(seo-audits): add rule-engine types and ajv dependency"

### task-02: Ruleset JSON Schemas

- scope_whitelist: [packages/seo-audits/rules/schema/*.schema.json]
- depends_on: task-01
- description: One JSON Schema per namespace (`schema-org-ruleset.schema.json`,
  `google-structured-data-ruleset.schema.json`, `eligibility-ruleset.schema.json`), matching the
  typedefs from task-01 exactly — these are what `registry.js` (task-04) validates every ruleset file
  against, and what CI validates every checked-in ruleset file against (task-06).
- commit_message: "feat(seo-audits): add ruleset JSON schemas for the three rule namespaces"

### task-03: Rule-engine modules (schema-org, google-requirements, eligibility)

- scope_whitelist: [packages/seo-audits/src/rule-engine/schema-org-engine.js, packages/seo-audits/src/rule-engine/google-requirements-engine.js, packages/seo-audits/src/rule-engine/eligibility-engine.js]
- depends_on: task-01
- description: Three pure functions per the audit spec — `schemaOrgEngine.validate(parsedBlock,
  ruleset)`, `googleRequirementsEngine.validate(schemaType, parsedBlock, ruleset)` (checks `required`
  flat + one level of `nested`; parses but does not evaluate `conditional` — reserved for later),
  `eligibilityEngine.evaluate(schemaType, ruleset)` (informational only, `severity: 'info'`, hedged
  wording, never a pass/fail signal). Grouped as one task since all three implement one design
  decision (the three-namespace separation) and are most reviewable together, confirming none of them
  bleed into each other's concern. No file I/O, no Lighthouse types — plain JS objects in, `Finding[]`
  out.
- commit_message: "feat(seo-audits): add schema-org, google-requirements, and eligibility rule engines"

### task-04: Rule registry

- scope_whitelist: [packages/seo-audits/src/rule-engine/registry.js]
- depends_on: task-02
- description: `resolveRuleset(rulesDir, versionOrCurrent)` — reads `current.json` or `{version}.json`
  directly, `JSON.parse`s it, validates against the matching namespace's schema (task-02) via `ajv`.
  **Must throw a clear, specific error** or a missing file, an unparseable file, or a file that fails
  schema validation — this is the flagged risk item from the audit spec: a malformed ruleset must fail
  loudly at config-resolution time, never silently produce an audit that mysteriously always
  passes/fails. Task-06 must include a test proving this specific behavior, not just the happy path.
- commit_message: "feat(seo-audits): add rule registry with schema-validated loading"

### task-05: Ruleset data — `Product` + `Article`, all three namespaces

- scope_whitelist: [packages/seo-audits/rules/schema-org/*.json, packages/seo-audits/rules/google/structured-data/*.json, packages/seo-audits/rules/eligibility/*.json]
- depends_on: task-02
- description: `2026-09.json` + `current.json` for each of the three namespaces, with the exact
  content specified in the audit spec (schema-org's universal `@context`/`@type` requirement;
  google/structured-data's `Product` including nested `offers` and `Article` flat; eligibility's
  `supported`/`richResultFeature` for both types).
- commit_message: "feat(seo-audits): add v1 ruleset data for Product and Article"

### task-06: Rule-engine and registry unit tests

- scope_whitelist: [packages/seo-audits/test/rule-engine/**]
- depends_on: task-03, task-04, task-05
- description: Unit tests for all three engines using inline mock rulesets (not the production data —
  keeps engine-logic tests independent of ruleset-content changes): `Product`'s nested `offers` check
  (pass and fail), `Article`'s flat check, eligibility's informational output for both types.
  Separately, registry tests using small test-only fixture files under
  `packages/seo-audits/test/fixtures/rules/`, **including a deliberately malformed one and a missing
  one** — this is the explicit test coverage the task-04 risk item requires; don't consider task-04
  done without this. Also validate every real file from task-05 against its schema (task-02) here, so
  a future edit to the production ruleset data that breaks schema validation fails CI.
- commit_message: "test(seo-audits): add rule-engine and registry unit tests"

### task-07: Migrate `structured-data-json-ld` onto the schema-org engine

- scope_whitelist: [packages/seo-audits/src/audits/structured-data-json-ld.js]
- depends_on: task-03, task-04, task-05
- description: Replace the inline `@context`/`@type` presence check with
  `schemaOrgEngine.validate(parsedBlock, schemaOrgRuleset)` (ruleset resolved via the registry, task-04,
  namespace `current`). `JSON.parse` failure handling stays direct code, not routed through the engine
  (a parse error isn't a rule violation). **No `meta`/id/scoring change** — same audit, same behavior.
  This is the flagged migration-regression risk: after this change, (1) the existing unit tests in
  `packages/seo-audits/test/audits/structured-data-json-ld.test.js` must still pass unchanged, and
  (2) re-run the real `lhci collect`/`lhci assert` verification against the same pass/fail/malformed
  test pages used in `docs/qa/structured-data-validation.md` — not just unit tests in isolation.
  Don't consider this task done until both are re-confirmed, not just claimed.
- commit_message: "refactor(seo-audits): migrate structured-data-json-ld onto the schema-org rule engine"

### task-08: New audit — `structured-data-schema-properties`

- scope_whitelist: [packages/seo-audits/src/audits/structured-data-schema-properties.js]
- depends_on: task-03, task-04, task-05
- description: Per the audit spec — for each parsed block, skip untracked types (v1: anything but
  `Product`/`Article`); `{score: null, notApplicable: true}` if no block has a tracked type;
  otherwise `googleRequirementsEngine.validate()` drives scoring, `eligibilityEngine.evaluate()` is
  always reported but never affects score. `DetailsType: table`, columns `blockIndex, type, namespace,
  property, message` — namespace column keeps the two finding kinds visually separate, never merged.
  Stamp `rulesetVersions` into `details`/`debugdata`.
- commit_message: "feat(seo-audits): add structured-data-schema-properties audit"

### task-09: Fixture tests for the new audit

- scope_whitelist: [packages/seo-audits/test/audits/structured-data-schema-properties.test.js]
- depends_on: task-08
- description: Mock-artifact tests (same pattern as `structured-data-json-ld.test.js`): `Product` pass
  (all required + nested present), `Product` fail (missing `offers.availability`), `Article` pass,
  `Article` fail (missing `datePublished`), not-applicable (no tracked type present), eligibility row
  present and correctly hedged in the pass case, `rulesetVersions` present in `details`/`debugdata`.
- commit_message: "test(seo-audits): add fixture tests for structured-data-schema-properties audit"

### task-10: Wire into custom Lighthouse config + regression test

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-07, task-08
- description: Add `'./audits/structured-data-schema-properties.js'` to the config's `audits` array
  and `{id: 'structured-data-schema-properties', weight: 1}` to `categories['seo-extended'].auditRefs`.
  Extend the existing regression test (same `initializeConfig` approach as before) to assert: `extends`
  still preserved (default audits present), **both** `structured-data-json-ld` and
  `structured-data-schema-properties` present, `seo-extended` category contains both.
- commit_message: "feat(seo-audits): register structured-data-schema-properties in the custom lighthouse config"

### task-11: Package README update

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-10
- description: Document `structured-data-schema-properties` alongside the existing
  `structured-data-json-ld` entry — what it checks, that severity is the consumer's own choice (not
  part of shared presets, same as the existing audit), and a short note on the three-namespace
  finding model (schema-org / Google requirements / eligibility) so report readers understand why
  eligibility rows are hedged differently from requirement failures.
- commit_message: "docs(seo-audits): document structured-data-schema-properties in the package README"
