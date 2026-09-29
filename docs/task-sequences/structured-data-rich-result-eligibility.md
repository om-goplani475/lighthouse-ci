# Task sequence: Rich-Result Eligibility Report

- slug: structured-data-rich-result-eligibility

Every task's `scope_whitelist` stays inside `packages/seo-audits`. No task reaches into
`packages/utils`/`packages/cli` — confirmed against `.ai-agents/prompts/monorepo-rules.md`, this
feature needs no new extension point (same `configPath` mechanism both existing audits already use).

Standard order for a new audit with no new gatherer/engine: audit implementation → registration →
fixture tests → docs.

## Tasks

### task-01: New audit — `structured-data-rich-result-eligibility`

- scope_whitelist: [packages/seo-audits/src/audits/structured-data-rich-result-eligibility.js]
- depends_on: none
- description: Per the audit spec and contract —
  - Import `resolveEligibilityRuleset` (from `../rule-engine/registry.js`) and `evaluate` (from
    `../rule-engine/eligibility-engine.js`, aliased `evaluateEligibility`). No other rule-engine
    imports — this audit never touches `google-requirements-engine.js` or the `schema-org`
    namespace.
  - `static get meta()` sets `scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE` — this is the one
    piece of the design most likely to be gotten wrong; confirm it's set on `meta`, not computed in
    `audit()`, per the audit spec's citation of `critical-request-chains.js:38`.
  - `audit()` logic: for each block in `artifacts.StructuredDataJsonLd`, `JSON.parse` it (reuse the
    same `tryParse`/`isObject` helper pattern already in `structured-data-schema-properties.js`,
    don't reinvent it); if unparseable or has no string `@type`, skip (a parse failure is already
    flagged by `structured-data-json-ld`, not this audit's concern, same reasoning already
    established for the sibling audit).
  - Group successfully-parsed blocks by exact `@type` string, **preserving first-appearance
    order** (iterate blocks in artifact order; first time a type is seen, create its row; on repeat,
    increment that row's `count`) — this makes output deterministic for a given page, required for
    fixture tests to assert exact row order, not just set membership.
  - If **zero** blocks parsed successfully at all (not "zero tracked types" — zero parseable JSON-LD
    period): return `{score: null, notApplicable: true}`. This is the one case that's actually
    not-applicable, per the feature spec's explicit narrowing.
  - Otherwise, for each grouped type: if `eligibilityRuleset.types[type]` exists, call
    `evaluateEligibility(type, eligibilityRuleset)` and take its one `Finding`'s `message` verbatim;
    set `tracked: 'Yes'`, `richResultFeature: eligibilityRuleset.types[type].richResultFeature`. If
    not present in the ruleset, set `tracked: 'No'`, `richResultFeature: ''`, and
    `message: '${type} is not a rich-result type Google currently documents guidance for.'` (fixed
    string, not from the ruleset — there's no ruleset entry to read from for an untracked type).
  - Always return `{score: null, scoreDisplayMode-driven-by-meta, details}` (never
    `notApplicable: true`) once there's at least one row — per Lighthouse's own `_normalizeAuditScore`
    behavior for `INFORMATIVE` mode (confirmed in the audit spec), the returned `score` value doesn't
    even need to be `null` explicitly checked by us at the call site, but return `null` anyway for
    clarity, matching the sibling audits' explicit-`null` convention.
  - Table headings: `type` (text), `count` (numeric), `tracked` (text), `richResultFeature` (text),
    `message` (text) — exact order from the contract.
  - Stamp `details.rulesetVersions = {eligibility: eligibilityRuleset.version}` via
    `@ts-expect-error`, same pattern as both existing audits (single-namespace stamp here, not the
    two-namespace stamp `structured-data-schema-properties` uses, since this audit only resolves
    one ruleset).
  - Class-level and `meta`-level `@ts-expect-error` comments for the closed-`Artifacts`-type
    boundary, same as both existing audits — copy the exact established wording, don't reinvent it.
- commit_message: "feat(seo-audits): add structured-data-rich-result-eligibility audit"

### task-02: Wire into custom Lighthouse config + regression test

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-01
- description: Add `'./audits/structured-data-rich-result-eligibility.js'` to the config's `audits`
  array and `{id: 'structured-data-rich-result-eligibility', weight: 1}` to
  `categories['seo-extended'].auditRefs`. Extend the existing regression test to assert: `extends`
  still preserved, all **three** structured-data audits present (not just the existing two),
  `seo-extended` category contains all three.
- commit_message: "feat(seo-audits): register structured-data-rich-result-eligibility in the custom lighthouse config"

### task-03: Fixture tests for the new audit

- scope_whitelist: [packages/seo-audits/test/audits/structured-data-rich-result-eligibility.test.js]
- depends_on: task-02
- description: Same shell-out-via-temp-files pattern as `structured-data-schema-properties.test.js`
  (this audit transitively imports `registry.js`, same `import.meta.url` Jest incompatibility
  applies). Cover, at minimum:
  - A page with one `Product` block and one `Recipe` block → two rows, each `count: 1`, both
    `tracked: 'Yes'`, correct `richResultFeature` per type, order matches block order.
  - A page with two `Product` blocks → **one** `Product` row with `count: 2`, not two separate rows
    — the core aggregation behavior this feature exists to implement; get this test wrong (e.g.
    assert two rows) and the whole point of "per-type summary, not per-block rows" isn't actually
    verified.
  - A page with an untracked type (e.g. `WebSite`) → one row, `tracked: 'No'`, `richResultFeature:
    ''`, the fixed "not currently documents guidance for" message — confirms the Gate-0-decided
    divergence from the sibling audit's silent-skip is real, not just documented.
  - A page with `FAQPage` (or `HowTo`) → `tracked: 'Yes'` (it IS one of the 12 tracked types) but
    its message is the "not currently documented as supported" wording, not the hedged-eligible
    wording — confirms `tracked` and `supported` are correctly kept as two different concepts, not
    conflated into one.
  - A page with zero parseable JSON-LD (empty artifact, or only malformed JSON) →
    `{score: null, notApplicable: true}`.
  - A page with JSON-LD but only untracked types → **not** not-applicable (per the feature spec's
    explicit narrowing) — result has `notApplicable` falsy/absent and a table with the "not tracked"
    row. This is the single most important regression to lock down: it's the concrete behavioral
    change this feature makes versus assuming the sibling audit's convention carries over.
  - Confirm `result.scoreDisplayMode` reads back as `'informative'` on a non-notApplicable result
    (read it off the audit's own `meta`, or run it through the shared `Audit._normalizeAuditScore`
    path if that's more faithful to real Lighthouse behavior — whichever the shell-out driver can
    actually exercise; note in the test which one was used).
  - `rulesetVersions` present and correct in `details`.
- commit_message: "test(seo-audits): add fixture tests for structured-data-rich-result-eligibility"

### task-04: Package README update, including the assertion-hazard warning

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-03
- description: Document the new audit alongside the existing two: what it reports (per-type
  eligibility summary, including untracked types), that it's purely informational
  (`scoreDisplayMode: informative`, never a pass/fail), and reuses the same `eligibility` namespace
  data `structured-data-schema-properties` already surfaces (cross-reference, don't duplicate the
  namespace explanation — point back to the existing "Finding namespaces" section).
  **Must include the assertion-hazard warning from the feature contract, close to verbatim** — this
  is not optional polish, it's the one place a consumer would actually see it before making the
  mistake: don't show `['error', {}]` for this audit id anywhere in the README; instead show the
  `{minScore: 0}` pattern (or "don't assert this audit at all") with a one-line explanation of why
  (`informative` mode maps to `0` for `minScore`, and the 0.9 default would make it always fail).
- commit_message: "docs(seo-audits): document structured-data-rich-result-eligibility and its assertion hazard"

<!-- No task touches rule-engine/ or rules/ — this feature is audit-layer-only, consistent with
both the audit spec and contract. -->
