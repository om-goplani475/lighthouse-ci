# Audit spec: Rich-Result Eligibility Report

- slug: structured-data-rich-result-eligibility
- upstream-sync checked against: lighthouse@12.6.1 (unchanged since the last two features —
  confirmed via `node_modules/lighthouse/package.json`, no `node_modules`/lockfile commits since).

**Correction (2026-09-29, added during `/write-qa`)**: the "INFORMATIVE scoreDisplayMode and lhci
assert" risk item below claimed `['error', {}]` would make this audit always *fail*. That was wrong
— verified live with a real `lhci collect`/`lhci assert` run: Lighthouse core normalizes an
`informative` audit's LHR `score` to `1` before `lhci assert` ever reads it, so a `minScore`
assertion on this audit always *passes*, regardless of threshold. The risk item is left below
unedited, as the record of what was reasoned about at design time; see
`docs/qa/structured-data-rich-result-eligibility.md` for the live verification that corrected it,
and `packages/seo-audits/README.md` for the corrected consumer-facing guidance.

## Gatherer

- New gatherer: none (reusing: `StructuredDataJsonLd`,
  `packages/seo-audits/src/gatherers/structured-data-json-ld.js`) — same artifact both existing
  structured-data audits already consume.

## Audit

- Audit id: `structured-data-rich-result-eligibility`. Confirmed no collision: grepped
  `node_modules/lighthouse/core/audits/` for the id and for `rich-result` — zero matches; also
  distinct from the two existing `packages/seo-audits` audit ids.
- **Scoring mechanism — the key design decision**: this audit is purely informational, never
  pass/fail, per the feature spec. Lighthouse has a real mechanism for exactly this, already used by
  core audits (e.g. `critical-request-chains.js:38`): `meta.scoreDisplayMode:
  Audit.SCORING_MODES.INFORMATIVE`, set once in `static get meta()`, not computed per-run. With that
  set, `audit()` always returns `{score: null, details}` when it has a table to show — `score: null`
  under `informative` mode is *not* the same as `notApplicable`; Lighthouse renders it as a neutral,
  always-visible table, not a skipped audit. This is meaningfully different from how
  `structured-data-schema-properties` returns `{score: null, notApplicable: true}` for its
  no-tracked-type case — that one really is "nothing to show," this one always has something to show
  once there's JSON-LD (even just "not tracked" rows).
- `notApplicable: true` reserved for exactly one case per the feature spec: **zero parseable JSON-LD
  blocks on the page at all**. A page with JSON-LD but only untracked types is *not* not-applicable —
  it gets a table with "not tracked" rows (this is the concrete, spec-approved behavior change from
  the sibling audit's silent-skip).
- **Aggregation logic (per-type summary, per Gate 0 decision)**: group all successfully-parsed
  blocks by `@type`, one row per distinct type found on the page, with a `count` of how many blocks
  had that type. For a tracked type, call `eligibilityEngine.evaluate(schemaType, ruleset)` once per
  distinct type (not once per block — the message doesn't vary by block, so evaluating per-block
  and then de-duplicating would be wasted work reaching the same conclusion N times).
- **Untracked-type grouping (resolving the audit spec's open question)**: group by the *exact*
  `@type` string, not a single collapsed "other" bucket — e.g. a page with both `WebSite` and
  `Thing` blocks gets two separate "not tracked" rows, not one. Justification: real pages rarely have
  more than 2-3 distinct schema.org types in practice (this fork's own test fixtures and the prior
  two features' QA pages never exceeded 2), so the "unbounded table" risk the feature spec raised is
  low, and per-type detail is strictly more useful for the inventory framing than a collapsed bucket
  that hides which types were actually found.
- `DetailsType`: `table`. Columns: `type` (text), `count` (numeric), `tracked` (text: "Yes"/"No" —
  chosen over a boolean `valueType` since Lighthouse's `Details.Table` boolean rendering is less
  consistent across the viewer than a plain text column, same reasoning already established for
  this package's other tables), `richResultFeature` (text, empty string when not tracked or not
  supported), `message` (text — the exact hedged/unsupported wording from `eligibility-engine.js`,
  reused verbatim, or a fixed "not tracked — no rich-result guidance available for this type" string
  for untracked rows).
- Stamp `rulesetVersions` into `details` (`{eligibility: ruleset.version}`) — same reproducibility
  convention as both existing audits. Only the `eligibility` namespace is used here; this audit never
  touches the `google-requirements` or `schema-org` rulesets.

## Category placement

- Category: `seo-extended` (existing), weight 1 — same category both existing structured-data
  audits are in. No new category.

## Extension point

Unchanged mechanism: `packages/seo-audits/src/lighthouse-config.js`'s `configPath`-based
registration — add to the `audits` array and `categories['seo-extended'].auditRefs`, exactly as
both existing audits are registered.

## Risks / open questions

- **Behavioral divergence from the sibling audit is intentional, not an inconsistency to "fix"
  later**: `structured-data-schema-properties` silently skips untracked types;
  `structured-data-rich-result-eligibility` reports them. Agent 04 should not "harmonize" these —
  they serve different purposes (one drives a pass/fail score and has no use for untracked-type
  noise; the other is a complete inventory). Worth a one-line note in this audit's own description
  string so a report reader isn't confused by the difference.
- **Performance**: grouping by type is a single pass over `StructuredDataJsonLd` blocks (already
  bounded by whatever the gatherer collects, same bound the two existing audits already accept) —
  no new performance concern.
- **`INFORMATIVE` scoreDisplayMode is a real, confirmed assertion footgun — not a "worth checking"
  item, already traced through the code**: `packages/utils/src/assertions.js:19` maps an
  `informative`-mode audit's value to a hardcoded `0` for `minScore` purposes (not `null`, not a
  skip). Combined with line 179's default — any `assertions` entry without an explicit `minScore`
  auto-applies `minScore: 0.9` — this means the exact pattern this package's own README shows for
  the two existing audits (`'audit-id': ['error', {}]`, empty options) would make **this** audit
  fail on every single page that has any JSON-LD at all, since `0 >= 0.9` is always false. This is
  not a corner case; it's the default, documented usage pattern silently producing an always-red CI
  check for a purely informational audit.
  - **Agent 02/04 must not repeat the `['error', {}]` example for this audit** in the contract or
    README. Correct guidance: don't assert this audit at all (it's informational, not a gate — the
    common case); if an entry is added anyway, it must set `{minScore: 0}` explicitly so line 179's
    0.9 default never kicks in. Confirmed against `types/assert.d.ts`'s real `AssertionOptions`
    shape (`minScore`/`maxLength`/`maxNumericValue`/`aggregationMethod` only) that there is no
    separate "did this audit run" option to use instead — `minScore: 0` is the actual fix, not a
    different assertion type.
  - **Agent 06 (QA) must verify this live**, not just cite this reasoning — actually run `lhci
    assert` with the naive `['error', {}]` pattern against a real collected result and confirm it
    fails as predicted, then verify `{minScore: 0}` passes, before this ships.
