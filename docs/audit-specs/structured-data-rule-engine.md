# Audit spec: Structured Data Rule Engine

- slug: structured-data-rule-engine
- upstream-sync checked against: lighthouse@12.6.1 (installed, unchanged since `structured-data-validation`
  — no upstream pull since; confirmed via `packages/utils/package.json` version and
  `git log -- packages/utils/package.json` showing no commits since 6b3b50e, well before this work).
  No drift: `Audit`/`BaseGatherer`/`Config` APIs, LHR shape, and the `configPath` extension mechanism
  are all identical to what was already verified for `structured-data-json-ld`.

## Rule engine (not a Lighthouse gatherer/audit itself — internal library code both audits use)

`packages/seo-audits/src/rule-engine/`:

- `types.js` — JSDoc typedefs: `Finding {namespace, type, property, severity, message}`,
  `RuleSet {version, ...namespace-specific shape}`.
- `registry.js` — `resolveRuleset(rulesDir, versionOrCurrent) → RuleSet`. Reads
  `{rulesDir}/current.json` (`{"version": "2026-09"}`) when `versionOrCurrent === 'current'`, else
  reads `{rulesDir}/{version}.json` directly. Pure file read + `JSON.parse` + schema validation (via
  `ajv`, already resolvable in `node_modules` at `6.12.6` — declare explicitly in
  `packages/seo-audits/package.json` rather than rely on hoisting, but do **not** bump its major
  version as a drive-by change). Throws if the file doesn't validate against its namespace's schema —
  a malformed ruleset file must fail loudly, not silently produce wrong findings.
- `schema-org-engine.js` — `validate(parsedBlock, ruleset) → Finding[]`. v1 checks only
  `ruleset.universal.required` (a flat list, e.g. `["@context", "@type"]`) against the parsed block's
  top-level keys — this is what `structured-data-json-ld` migrates onto.
- `google-requirements-engine.js` — `validate(schemaType, parsedBlock, ruleset) → Finding[]`. Looks up
  `ruleset.types[schemaType]`; if absent, returns `[]` (type not tracked, not a failure — the audit
  layer decides what "not tracked" means for scoring, the engine just doesn't invent findings for
  types it has no rules for). Checks `required` (flat) and `nested` (one level: for each
  `nested[key]`, if `parsedBlock[key]` exists, check `nested[key].required` against its keys).
  `conditional` is parsed by the registry/schema but **not evaluated** by this engine in v1 — reserved
  for a later feature once a real conditional rule exists.
- `eligibility-engine.js` — `evaluate(schemaType, ruleset) → Finding[]`. Deliberately thin: looks up
  `ruleset.types[schemaType].supported` (boolean) and `richResultFeature` (display name string).
  Returns one informational `Finding` (not an error/failure — `severity: 'info'`, distinct from the
  other two engines' `severity: 'error'`) with explicitly hedged wording ("may be eligible for
  consideration for {richResultFeature}; valid markup does not guarantee Google will display a rich
  result"). **This is not a duplicate of the google-requirements check** — it doesn't re-validate
  properties, it only reports whether the type is currently one Google documents support for at all.
  Kept genuinely separate per the architecture doc's three-namespace rule.

None of these four files touch the DOM, CDP, or the filesystem outside `rules/` — fully unit-testable
with plain JS objects, no Lighthouse test harness needed for the engine layer itself.

## Ruleset data (v1: `Product` + `Article` only)

`packages/seo-audits/rules/`:

- `schema-org/2026-09.json`: `{"version": "2026-09", "universal": {"required": ["@context", "@type"]}, "types": {}}`
- `google/structured-data/2026-09.json`: `{"version": "2026-09", "types": {"Product": {"required": ["name", "image", "offers"], "nested": {"offers": {"type": "Offer", "required": ["price", "priceCurrency", "availability"]}}, "conditional": []}, "Article": {"required": ["headline", "image", "datePublished"], "nested": {}, "conditional": []}}}`
- `eligibility/2026-09.json`: `{"version": "2026-09", "types": {"Product": {"supported": true, "richResultFeature": "Product snippets"}, "Article": {"supported": true, "richResultFeature": "Article rich results"}}}`
- Each namespace also gets `current.json`: `{"version": "2026-09"}`.
- `rules/schema/*.schema.json` — one JSON Schema per namespace shape above, validated by `registry.js`
  via `ajv`, and separately validated in `npm run test:unit` against every checked-in ruleset file (so
  a malformed ruleset fails CI even if no audit run happens to exercise it).

## Gatherer

- New gatherer: **no**. Both audits below consume the existing `StructuredDataJsonLd` gatherer
  (`packages/seo-audits/src/gatherers/structured-data-json-ld.js`), unchanged.

## Audit 1 (migrated): `structured-data-json-ld`

- **No id change, no scoring change.** Same `meta`, same `requiredArtifacts`. Internal change only:
  the `@context`/`@type` presence check becomes `schemaOrgEngine.validate(parsedBlock, schemaOrgRuleset)`
  instead of inline field checks. `JSON.parse` failure handling **stays direct code, not an engine
  concern** — a parse error is a data-format problem, not a rule violation; routing it through the
  engine would blur that distinction for no benefit.
- Must produce byte-identical scoring behavior on every existing fixture
  (`packages/seo-audits/test/audits/structured-data-json-ld.test.js`) and the live-verified cases in
  `docs/qa/structured-data-validation.md` — this is a refactor of already-shipped code, treated with
  the same care as any change to working code.

## Audit 2 (new): `structured-data-schema-properties`

- Audit id: `structured-data-schema-properties`
- `requiredArtifacts: ['StructuredDataJsonLd']`
- For each successfully-parsed block: read its `@type`. If not `Product` or `Article`, skip it (not
  tracked in v1). If no block in the page has a tracked type, the audit returns
  `{score: null, notApplicable: true}` — same "don't fail pages with no reason to have this markup"
  rule as feature #2's original spec.
- For each tracked-type block: `googleRequirementsEngine.validate(type, block, googleRuleset)` for
  pass/fail findings (drives the score — any finding here fails the audit), and separately
  `eligibilityEngine.evaluate(type, eligibilityRuleset)` for the informational eligibility note
  (never affects score, always reported, always hedged).
- `DetailsType`: `table`. Columns: `blockIndex`, `type`, `namespace` (`google-requirement` |
  `eligibility`), `property` (empty for eligibility rows), `message`. Namespace stays a visible column
  so the two kinds of finding are never visually merged into one undifferentiated list, per the
  architecture doc's separation requirement.
- `details`/`debugdata` also carries `rulesetVersions: {googleStructuredData: "2026-09", eligibility: "2026-09"}`
  (and `structured-data-json-ld` gets `rulesetVersions: {schemaOrg: "2026-09"}` too) — the
  reproducibility mechanism from the architecture doc, mirroring Lighthouse's own `lighthouseVersion`
  stamp on the LHR.

## Category placement

- Both audits join the **existing** `seo-extended` category (created by `structured-data-validation`)
  — not a new category. Add `{id: 'structured-data-schema-properties', weight: 1}` to its
  `auditRefs`; `structured-data-json-ld` is already there.

## Extension point

Same verified mechanism as before — the custom Lighthouse config at
`packages/seo-audits/src/lighthouse-config.js` (`configPath`, `extends: 'lighthouse:default'`
preserved). Add `'./audits/structured-data-schema-properties.js'` to its `audits` array and the new
`auditRefs` entry to `categories['seo-extended']`. No new `artifacts` entry needed (no new gatherer).

## Risks / open questions for Agent 04

- **Migration regression**: run `structured-data-json-ld`'s existing test suite and the real
  `lhci collect`/`lhci assert` verification (matching what `docs/qa/structured-data-validation.md`
  already did) after migrating it onto the engine, before considering that task done — not just unit
  tests in isolation.
- **`ajv` dependency**: declare explicitly in `packages/seo-audits/package.json` at `^6.12.6` (the
  version already resolvable in this repo's `node_modules`) rather than adding a newer major version —
  confirm this doesn't conflict with whatever else in the monorepo already depends on it transitively.
- **Registry error handling**: a missing/malformed `current.json` or ruleset file should throw a clear
  error at config-resolution time (when Lighthouse loads the config), not fail silently or produce an
  audit that mysteriously always passes/fails.
