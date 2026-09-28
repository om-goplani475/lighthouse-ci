# Architecture decision: structured-data rule engine

- decided: 2026-09-28
- status: B (versioned rule registry, hand-maintained) approved for build. C/D/E deferred — see below.

## Why this exists

Feature #2 (`structured-data-schema-properties`, required/recommended properties per rich-result
type) was originally speced with rules hardcoded into the audit (`if (type === 'Product') {...}`).
Its own intake doc flagged this as a drift risk: Google's structured-data guidance isn't static, and
hardcoded rules mean a manual code edit every time it changes. Before building feature #2, we
discussed the right architecture for this and decided to build a small rule engine foundation first,
then populate it with feature #2's content as data rather than code. Full discussion happened in
conversation on 2026-09-28; this doc is the durable record of the decision and reasoning, so it
doesn't live only in a chat transcript.

## Three separate rule namespaces — never conflated

- **schema.org validity** — is this a valid schema.org type, are these valid properties for it.
- **Google Search requirements** — what does Google's documentation say is required/recommended for
  a type to be eligible for a rich result.
- **Rich-result eligibility** — does this markup appear to satisfy currently-documented requirements.
  Explicitly hedged language always — valid markup is never claimed to guarantee Google will actually
  display a rich result.

Each gets its own rule data, its own `validate()`/`evaluate()` call, and its own findings in the
audit's report — never merged into one undifferentiated check.

## Data model

One JSON file per ruleset version per namespace (not one file per type — avoids directory sprawl
across 12 types × many versions, and keeps a version's full diff visible in one `git diff`):

```
rules/
  schema-org/{version}.json, current.json
  google/structured-data/{version}.json, current.json
  eligibility/{version}.json, current.json
  schema/*.schema.json   # JSON Schema each ruleset file must validate against, enforced in CI
```

Versions are calendar-based (`2026-09`, not semver) — the question is "what did Google say as of this
date," which a date answers directly. `current.json` is a small manifest (`{"version": "2026-09"}`),
never a symlink. Every audit result stamps which ruleset version(s) it used
(`rulesetVersions: {...}`), mirroring Lighthouse's own `lighthouseVersion` field on the LHR — this,
plus never deleting/mutating a published version file, is the entire mechanism for reproducing an old
audit with the ruleset that existed at the time. No time-travel infrastructure needed.

The rule schema reserves a `conditional` field from day one (e.g. `{"if": {"property": "review"},
"then": {"required": ["aggregateRating"]}}`), even though v1's hand-authored rules may not populate
it for every type — retrofitting conditional support into a flat-list schema later is exactly the
kind of rewrite this whole exercise is trying to avoid.

## What's being built now (B)

- The three-namespace rule model as versioned JSON, hand-authored (no automation).
- A small `RuleEngine` (`validate(data, ruleset) → Finding[]`, pure, no I/O) and `RuleRegistry`
  (`resolve(version | 'current') → RuleSet`, the only thing that touches `rules/`).
- The audit thinned to: gatherer artifact → parse → `engine.validate()` × 3 namespaces → format as
  Lighthouse `details.table`. No type-specific logic inside the audit file.
- `rulesetVersions` stamped into every result.
- JSON Schema validation of every ruleset file enforced in `npm run test:unit`/CI.
- Proven against a small number of types first (not all 12) — see the rule-engine feature's own spec
  for exact scope.

## What's explicitly deferred, and why

**Build later** (not now, not never — revisit once B has run in practice for a while):

- Automated Google-documentation change detection (periodic text-content snapshot diffing of tracked
  doc pages, alerting on detected changes). Honest finding: Google provides no reliable
  machine-readable feed of structured-data requirement changes — this can only ever be a "something
  changed here, go look" trigger, never a source of truth by itself.
- LLM-assisted semantic diff / rule-change proposal generation, strictly bounded: docs → LLM/parser →
  proposed rule diff → JSON-Schema validation → regression test against a fixture corpus (does the
  proposed ruleset change pass/fail on any existing fixture? if not, likely a true no-op) → human
  review → publish. The LLM never writes directly to `rules/`.

**Do not build** (real no, not a "later," unless something concrete changes this):

- Fully autonomous rule publishing. Given no reliable machine-readable source exists, and given the
  worst-case failure (a bad rule silently ships into every consumer's CI) is disproportionate to the
  value of skipping a PR approval, this isn't worth the safety infrastructure (canary rollout,
  auto-rollback, blast-radius limiting) it would need to be trustworthy.
- A general conditional-requirements DSL beyond the reserved schema field — build actual conditional
  logic only once a real example forces it, not speculatively.

## Failure modes considered (see full discussion for mitigations)

Google rewording docs without changing the rule; Google removing a feature; required↔recommended
flips; conditional/contextual requirements; doc page structure changes breaking scraping; LLM
misreading documentation; experimental/temporary Google guidance; schema.org/Google divergence;
race conditions between doc changes and update checks; stale/cached fetches; false positives from a
bad rule update; a bad rule getting auto-published; a malformed ruleset file shipping as valid; the
`current` pointer moving as a side effect of an unrelated change. Each has a specific mitigation
(fixture-regression-corpus checks, append-only versioning, explicit `status: stable|experimental`
fields, mandatory human review, CI-enforced schema validation, etc.) — see conversation history for
the full table if this doc needs to be expanded later.
