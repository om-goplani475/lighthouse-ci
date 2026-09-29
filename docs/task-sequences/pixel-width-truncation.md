# Task sequence: Title and Meta Description Pixel-Width Truncation

- slug: pixel-width-truncation

## Tasks

### task-01: `serp-pixel-budgets` types + JSON Schema

- scope_whitelist: [packages/seo-audits/src/rule-engine/types.js, packages/seo-audits/rules/schema/serp-pixel-budgets-ruleset.schema.json]
- depends_on: none
- description: Add `SerpPixelBudgetsField`/`SerpPixelBudgetsRuleSet` JSDoc typedefs to
  `rule-engine/types.js` (additive only — do not touch `Finding`/`FindingNamespace` or any existing
  typedef, per the feature contract's explicit statement that this feature doesn't use the `Finding`
  model at all). Write the matching JSON Schema (`title`/`description`, each requiring `font: string`
  and `maxWidthPx: {desktop: number, mobile: number}`, plus top-level `version: string`) — this is
  what task-03's registry function validates every ruleset file against.
- commit_message: "feat(seo-audits): add serp-pixel-budgets types and JSON schema"

### task-02: `serp-pixel-budgets` ruleset data (v1)

- scope_whitelist: [packages/seo-audits/rules/serp-pixel-budgets/*.json]
- depends_on: task-01
- description: `2026-10.json` + `current.json` with the exact v1 content from the audit spec
  (`title.font: "400 20px Arial, sans-serif"`, `title.maxWidthPx: {desktop: 600, mobile: 580}`,
  `description.font: "400 14px Arial, sans-serif"`, `description.maxWidthPx: {desktop: 920, mobile:
  680}`). No other content — this is data only, not logic.
- commit_message: "feat(seo-audits): add v1 serp-pixel-budgets ruleset data"

### task-03: `resolveSerpPixelBudgetsRuleset()` in the registry

- scope_whitelist: [packages/seo-audits/src/rule-engine/registry.js]
- depends_on: task-01, task-02
- description: Add `resolveSerpPixelBudgetsRuleset(versionOrCurrent)` alongside the four existing
  `resolve*Ruleset` exports, following the exact same additive pattern `structured-data-type-conflicts`
  used to add its own namespace — same file/schema resolution and `ajv` validation flow as every
  existing `resolve*Ruleset` function, pointed at `rules/serp-pixel-budgets/` and the task-01 schema.
  **No existing `resolve*Ruleset` function's behavior or signature may change** — this is the specific
  regression risk for this task; the other four must keep passing their existing tests untouched.
- commit_message: "feat(seo-audits): add resolveSerpPixelBudgetsRuleset to the rule registry"

### task-04: Registry unit tests for `serp-pixel-budgets`

- scope_whitelist: [packages/seo-audits/test/rule-engine/registry.test.js]
- depends_on: task-03
- description: Extend the existing registry test file with `resolveSerpPixelBudgetsRuleset()` cases:
  resolves `current` to the real v1 data, throws clearly on a missing version, throws clearly on a
  deliberately malformed test fixture that fails schema validation (same loud-failure discipline the
  registry already enforces for every other namespace — don't skip this because the namespace is new
  and small). Confirm the four pre-existing `resolve*Ruleset` tests are unmodified and still pass.
- commit_message: "test(seo-audits): add registry tests for serp-pixel-budgets"

### task-05: `PixelWidth` gatherer

- scope_whitelist: [packages/seo-audits/src/gatherers/pixel-width.js]
- depends_on: task-03
- description: New gatherer per the audit spec — imports `resolveSerpPixelBudgetsRuleset()` at module
  scope (the documented architectural exception: this gatherer is not rule-agnostic, it needs
  `.title.font`/`.description.font` to measure with). One
  `driver.executionContext.evaluate(fn, {args: [titleFont, descriptionFont], useIsolation: true})`
  round-trip: reads `document.title`, reads
  `document.querySelector('meta[name="description"]')?.content`, measures each via an off-screen
  canvas (`ctx.font = font; ctx.measureText(text).width`), returns `{title: {text, widthPx} | null,
  description: {text, widthPx} | null}` — `null` per field when the element/content is absent, no
  presence-check duplication of `document-title`/`missing-meta-description`. The gatherer resolves
  **font only**, never `maxWidthPx` — that stays the audit's concern (task-06).
- commit_message: "feat(seo-audits): add PixelWidth gatherer"

### task-06: `pixel-width-truncation` audit

- scope_whitelist: [packages/seo-audits/src/audits/pixel-width-truncation.js]
- depends_on: task-03, task-05
- description: New audit, id `pixel-width-truncation`, `scoreDisplayMode:
  Audit.SCORING_MODES.INFORMATIVE` (resolved, not defaulted — see audit spec). `audit(artifacts,
  context)` resolves `resolveSerpPixelBudgetsRuleset()` separately from the gatherer, reads
  `context.settings.formFactor` to pick `maxWidthPx[formFactor]` for each of `title`/`description`
  present in the `PixelWidth` artifact, adds a row when `widthPx > maxWidthPx`. `{score: null,
  notApplicable: true}` only when **both** `title` and `description` are `null` in the artifact — a
  single missing field is just skipped, never `notApplicable` on its own. `DetailsType: table`,
  columns `field`/`widthPx`/`maxWidthPx`/`text`. Stamp `details.rulesetVersions = {serpPixelBudgets:
  ruleset.version}`. Report `description`/failure messaging must use hedged language ("may be
  truncated based on an approximate rendering model"), never "will be truncated" or unqualified "is
  too long" — carried through from the feature spec's explicit requirement.
- commit_message: "feat(seo-audits): add pixel-width-truncation audit"

### task-07: Wire into custom Lighthouse config + regression test

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-05, task-06
- description: Register the `PixelWidth` gatherer in `artifacts` and the `pixel-width-truncation`
  audit in `audits`/`categories['seo-extended'].auditRefs` (`weight: 1`). Extend the existing
  `initializeConfig` regression test to assert both the new gatherer and audit are present alongside
  every previously-registered one (additive assertion, not a replacement of existing checks).
- commit_message: "feat(seo-audits): register PixelWidth and pixel-width-truncation in the lighthouse config"

### task-08: Gatherer unit test

- scope_whitelist: [packages/seo-audits/test/gatherers/pixel-width.test.js]
- depends_on: task-05
- description: Mock `driver.executionContext.evaluate` (same pattern as
  `test/gatherers/structured-data-json-ld.test.js`) to unit-test the gatherer's own logic in
  isolation: both fields present, description absent (`null`), both absent, and that the resolved
  `title.font`/`description.font` strings are passed through as `args` unchanged. This is a mocked
  unit test, not a substitute for the live `lhci collect` re-verification in task-09's QA follow-up —
  it does not re-prove the canvas mechanism itself (already proven live during design, see the audit
  spec), only this gatherer's control flow.
- commit_message: "test(seo-audits): add unit tests for the PixelWidth gatherer"

### task-09: Audit fixture tests

- scope_whitelist: [packages/seo-audits/test/audits/pixel-width-truncation.test.js]
- depends_on: task-06
- description: Mock-artifact tests (same pattern as `structured-data-json-ld.test.js`): title over
  budget / description over budget / both over budget / both under budget (no rows) / one field
  `null` (skipped, not `notApplicable`) / both fields `null` (`notApplicable: true`) / desktop vs.
  mobile `formFactor` selecting different `maxWidthPx` values / `rulesetVersions` present in
  `details`. Also include the fallback-font regression check flagged as a risk in the audit spec: two
  fixture strings of very different character composition (e.g. all-"i" vs. all-"W" of equal length)
  must produce **different** `widthPx` values in the mocked artifact data used here — this test
  documents the expectation Agent 04 must also sanity-check live in task-05's manual verification,
  not a substitute for it.
- commit_message: "test(seo-audits): add fixture tests for pixel-width-truncation audit"

### task-10: Package README update

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-07
- description: Document `pixel-width-truncation` alongside the existing audits — what it checks, that
  it's `scoreDisplayMode: informative` and therefore **always passes any `minScore` assertion**
  (state this exactly as plainly as `structured-data-rich-result-eligibility`'s corrected entry, not
  the `['error', {}]` pattern used for scored audits), and the ruleset-accuracy caveat (approximate,
  reverse-engineered font/budget values, not verified Google documentation) in the same hedged
  language used in the audit's own report messaging.
- commit_message: "docs(seo-audits): document pixel-width-truncation in the package README"
