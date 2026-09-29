# Feature contract: Rich-Result Eligibility Report

- slug: structured-data-rich-result-eligibility

**Correction (2026-09-29, added during `/write-qa`)**: the "Assertion presets" section below
originally documented a supposed `['error', {}]` failure hazard for this audit — that was wrong,
disproven by a live `lhci assert` run (Lighthouse normalizes `informative`-mode `score` to `1`
before `lhci assert` reads it, so a `minScore` assertion always passes). The section is left below
unedited as the design-time record; see `docs/qa/structured-data-rich-result-eligibility.md` and
`packages/seo-audits/README.md` for the corrected guidance.

## TypeScript types

**No changes to `packages/seo-audits/src/rule-engine/types.js`.** This audit reuses
`EligibilityRuleSet`/`EligibilityRuleSetTypeRule` exactly as they exist — no new rule-engine
typedefs, matching the audit spec's confirmation that no engine code changes.

New typedef, local to the audit file itself (same convention as
`structured-data-schema-properties.js`'s own inline row shape — audit-specific report row types
don't belong in `rule-engine/types.js`, which is reserved for `Finding`/ruleset shapes):

```js
// packages/seo-audits/src/audits/structured-data-rich-result-eligibility.js

/**
 * @typedef {{
 *   type: string,
 *   count: number,
 *   tracked: 'Yes' | 'No',
 *   richResultFeature: string,
 *   message: string,
 * }} EligibilitySummaryRow
 */
```

## `.lighthouserc.js` config additions

**None.** Same as both existing structured-data audits — rides the existing `configPath` mechanism
already wired up in `packages/seo-audits/src/lighthouse-config.js`. No new config schema.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a — not part of shared presets |
| lighthouse:all | n/a — not part of shared presets |
| (fork preset) | n/a — not part of shared presets |

**Not added to `recommended.js`/`all.js`** — same reasoning as both existing audits: this audit is
opt-in via `configPath`, never one of Lighthouse's own default audits, and
`packages/utils/test/presets.test.js` would fail if it were added.

**A real, code-confirmed hazard for consumers setting their own assertion, not a hypothetical**:
`packages/utils/src/assertions.js:19` maps an `informative`-scoreDisplayMode audit's `minScore`
value to a hardcoded `0`, and line 179 auto-applies a `minScore: 0.9` default to *any* assertion
entry that doesn't explicitly set one. So the exact pattern this package's README shows for the two
existing audits —

```js
'structured-data-rich-result-eligibility': ['error', {}],  // DO NOT DO THIS
```

— would make this audit fail on every single page with any JSON-LD, unconditionally, since
`0 >= 0.9` is always false. This is not this audit's own bug (it's a general Lighthouse-CI
`informative`-mode interaction), but it's this feature's responsibility to document correctly since
it's the first `informative`-mode audit this package ships.

**Correct guidance for the README** (must not show the `['error', {}]` pattern for this audit —
verified against `types/assert.d.ts`'s real `AssertionOptions` shape, which is only `minScore`,
`maxLength`, `maxNumericValue`, `aggregationMethod`; there is no user-settable "did this audit run"
option, so the fix is an explicit `minScore`, not a different assertion type):

```js
// Recommended: don't add this audit to `assertions` at all — it's informational, there's
// nothing to gate CI on. Omitting it entirely means it's simply never checked.

// If you do want an entry (e.g. purely to see it listed in `lhci assert` output), it must set
// minScore explicitly to avoid the 0.9 default trap described above:
'structured-data-rich-result-eligibility': ['warn', {minScore: 0}],  // minScore: 0 always passes
```

## Public exports

**None new.** No new dependency (this audit only imports the already-shipped
`resolveEligibilityRuleset()`/`eligibilityEngine.evaluate()`). `packages/seo-audits/package.json` is
unchanged. `packages/cli` still never imports `@lhci/seo-audits` directly.

The only files this feature's implementation touches:
- `packages/seo-audits/src/audits/structured-data-rich-result-eligibility.js` (new)
- `packages/seo-audits/src/lighthouse-config.js` (register the new audit + category ref)
- `packages/seo-audits/test/audits/structured-data-rich-result-eligibility.test.js` (new)
- `packages/seo-audits/test/lighthouse-config.test.js` (extend regression assertions)
- `packages/seo-audits/README.md` (document the new audit, including the assertion-hazard note
  above verbatim — this is not optional documentation, it's the one way to prevent a real
  footgun this feature's own design surfaced)

## Consistency check

Cross-checked against `docs/audit-specs/structured-data-rich-result-eligibility.md`:

- The `EligibilitySummaryRow` shape above matches the audit spec's table columns exactly
  (`type, count, tracked, richResultFeature, message`).
- The audit spec's `scoreDisplayMode: INFORMATIVE` decision is why this contract's assertion-preset
  section is unusually long — the audit spec flagged the risk, this contract is where it becomes a
  concrete, enforceable requirement (the README must show the corrected snippet, not the pattern
  used for the other two audits).
- No rule-engine or ruleset-data changes in either doc — both agree this is audit-layer-only.
