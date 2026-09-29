# Feature contract: Title and Meta Description Pixel-Width Truncation

- slug: pixel-width-truncation

## TypeScript types

```js
// packages/seo-audits/src/rule-engine/types.js — additive change only

/**
 * @typedef {{font: string, maxWidthPx: {desktop: number, mobile: number}}} SerpPixelBudgetsField
 */
/**
 * @typedef {{
 *   version: string,
 *   title: SerpPixelBudgetsField,
 *   description: SerpPixelBudgetsField,
 * }} SerpPixelBudgetsRuleSet
 */
```

No change to `FindingNamespace`/`Finding` — this feature does not use the `Finding` model at all.
Unlike every structured-data audit, this one doesn't produce namespaced findings; it's a direct
measured-value-vs-budget table. Confirmed deliberate, not an oversight: `Finding`'s shape
(`namespace/type/property/severity/message`) doesn't fit "here's a measured pixel width and a
budget" naturally, and forcing it in would add a namespace (`'pixel-truncation'`?) with only one
audit ever using it, for no real benefit over a purpose-built row shape.

```js
// packages/seo-audits/src/gatherers/pixel-width.js — artifact shape, documented here since
// Agent 04 needs the exact contract both the gatherer and audit agree on

/**
 * @typedef {{text: string, widthPx: number} | null} PixelWidthMeasurement
 */
/**
 * @typedef {{title: PixelWidthMeasurement, description: PixelWidthMeasurement}} PixelWidthArtifact
 */
```

```js
// packages/seo-audits/src/audits/pixel-width-truncation.js — audit-local report row shape

/**
 * @typedef {{field: 'title' | 'description', widthPx: number, maxWidthPx: number, text: string}} PixelWidthRow
 */
```

## `.lighthouserc.js` config additions

**None.** Same as every prior audit in this package — rides the existing `configPath` mechanism.
No new config schema.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a — not part of shared presets |
| lighthouse:all | n/a — not part of shared presets |
| (fork preset) | n/a — not part of shared presets |

Not added to `recommended.js`/`all.js` — same reasoning as every prior audit (opt-in via
`configPath`, `packages/utils/test/presets.test.js` would fail otherwise).

**This audit is `scoreDisplayMode: informative`** (per the audit spec's explicit resolution of the
feature spec's scoring question) — same consequence as `structured-data-rich-result-eligibility`:
Lighthouse normalizes an `informative` audit's LHR `score` to `1` before `lhci assert` ever reads
it, so a `minScore` assertion on this audit always passes, regardless of threshold. The README must
state this plainly and must **not** show the `['error', {}]` pattern used for scored audits in this
package — same corrected wording pattern already established in
`packages/seo-audits/README.md` for `structured-data-rich-result-eligibility`, reused here rather
than re-deriving it (and re-risking the same wrong-then-corrected mistake that feature's docs went
through).

## Public exports

**No new dependency** — `ctx.measureText()` is a standard Canvas 2D API, no library needed.

New/modified files, all within `packages/seo-audits`:
- `packages/seo-audits/src/gatherers/pixel-width.js` (new gatherer)
- `packages/seo-audits/src/audits/pixel-width-truncation.js` (new audit)
- `packages/seo-audits/rules/serp-pixel-budgets/{version}.json` + `current.json` (new namespace)
- `packages/seo-audits/rules/schema/serp-pixel-budgets-ruleset.schema.json` (new JSON Schema)
- `packages/seo-audits/src/rule-engine/registry.js` — **modified**, adds
  `resolveSerpPixelBudgetsRuleset()` alongside the four existing `resolve*Ruleset` exports
  (additive function, no change to any existing export's behavior or signature — same
  additive-only discipline as when `structured-data-type-conflicts` added its own namespace)
- `packages/seo-audits/src/rule-engine/types.js` — **modified**, additive typedef only
- `packages/seo-audits/src/lighthouse-config.js` — registers the new gatherer + audit + category
  ref
- Test files under `packages/seo-audits/test/gatherers/`, `test/audits/`, `test/rule-engine/`
- `packages/seo-audits/README.md` — documents the new audit, including the assertion-hazard note
  above verbatim, and the ruleset-accuracy caveat

`packages/cli` still never imports `@lhci/seo-audits` directly — unchanged pattern.

## Consistency check

Cross-checked against `docs/audit-specs/pixel-width-truncation.md`:

- `SerpPixelBudgetsRuleSet`'s shape matches the audit spec's v1 ruleset content example exactly
  (`title`/`description`, each with `font` and per-`formFactor` `maxWidthPx`).
- `PixelWidthArtifact`'s `null`-per-field shape matches the audit spec's stated behavior:
  presence/absence of title or description is not this audit's concern (already covered by
  `document-title` and `missing-meta-description` respectively) — a `null` field is simply skipped
  when building rows, never a reason for `notApplicable` on its own (only *both* being `null`
  triggers that).
- The `scoreDisplayMode: informative` decision and its `lhci assert` consequence are carried
  through consistently from audit spec → this contract → (pending) README — the exact chain that
  broke once before (`structured-data-rich-result-eligibility`'s docs were wrong until corrected
  during QA); this contract states the *already-verified* correct behavior from the start rather
  than re-deriving it and risking the same mistake.
- The gatherer's dependency on `registry.js` (a real architectural first, per the audit spec) is
  reflected in this contract's file list — `pixel-width.js` (gatherer) is listed as a *new* file
  that itself imports from `rule-engine/`, which no prior gatherer in this package has done.
