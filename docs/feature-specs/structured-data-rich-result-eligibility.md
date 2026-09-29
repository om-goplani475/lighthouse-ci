# Feature: Rich-Result Eligibility Report

- slug: structured-data-rich-result-eligibility
- requested: 2026-09-28
- type: new-audit

## Summary

Roadmap feature #1: a standalone audit that reports, for each JSON-LD block on a page, whether its
schema type is one Google currently documents rich-result support for — reusing the existing
`eligibility-engine.js`/`eligibility` ruleset namespace, adding no new rule content or engine logic.

**Read this before approving Gate 0 — a real redundancy question, not a formality**: this
information is *already surfaced today*. `structured-data-schema-properties`
(`packages/seo-audits/src/audits/structured-data-schema-properties.js:99`) calls
`evaluateEligibility()` for every tracked-type block and includes the result as
`namespace: 'eligibility'` rows in its own report table, unconditionally, regardless of whether the
block passes its required-property check. I verified this by reading the audit's `audit()` method
directly, not assuming from memory. So the question this spec can't resolve on its own: is a
*second*, dedicated audit that reports only this subset of already-visible data worth building, or
should roadmap feature #1 instead be closed as "already satisfied," the way `missing-meta-description`
was closed in this same pipeline?

### The case for building it anyway

- **Audience separation**: `structured-data-schema-properties` mixes two different questions in one
  table — "is your markup broken" (`google-requirements`, drives score) and "could this ever earn a
  rich result" (`eligibility`, informational). Someone who only wants the second question (e.g. "what
  rich results is my site in the running for," a Search-Console-style inventory) has to read past
  property-failure rows to find it.
- **Score semantics**: because eligibility rows live inside a scored audit, a page that's 100%
  ineligible for any rich result (e.g. only has `WebSite`/`Thing` markup, no tracked type at all)
  still shows `structured-data-schema-properties` as `notApplicable`, not as "you have zero rich-result
  eligibility" — the two are conflated. A dedicated audit could report that more directly.
- **Precedent for closing instead**: `missing-meta-description` was closed with zero implementation
  because it was already fully covered by an existing Lighthouse core audit. The situation here is
  narrower — the data already exists, but as *rows inside a different audit's report*, not as a
  fully duplicate audit. That's a real distinction, but a debatable one; recommend Gate 0 makes the
  call explicitly rather than defaulting either way.

**Decided at Gate 0 (2026-09-29): build it.** Scoped as a thin report-formatting layer — no new rule
content, no new scoring logic beyond "always informational," same contract the existing eligibility
rows already have.

## Concrete pass/fail example

Not a pass/fail check, by design — same "informational only" contract the existing `eligibility`
namespace already has (`eligibility-engine.js`'s own header comment: "does NOT re-validate
properties... never affects an audit's score").

**Decided at Gate 0 (2026-09-29): per-type summary, not per-block rows.** Aggregate across all
blocks on the page — one row per distinct `@type` found, not one row per JSON-LD block. A page with
two `Product` blocks gets one `Product` summary row (with a count), not two identical rows.

**Decided at Gate 0 (2026-09-29): untracked types get their own row**, not a silent skip. This is a
deliberate divergence from `structured-data-schema-properties`'s existing behavior — that audit
silently skips any `@type` outside the 12 tracked types because it has nothing to check for them;
this audit's job is a complete inventory, so an untracked type is itself a reportable fact ("no
rich-result guidance available for this type"), not a null result.

- **Reports**: a page with a `Product` block, two `Recipe` blocks, and a `WebSite` block → three
  summary rows: `Product` (count 1, eligible for "Product snippets"), `Recipe` (count 2, eligible for
  "Recipe rich results"), `WebSite` (count 1, "not tracked — no rich-result guidance available").
- **Not applicable**: a page with no JSON-LD at all → `score: null`, `notApplicable: true`, same
  convention as `structured-data-schema-properties`. Note this is now a narrower condition than
  before — a page whose only JSON-LD is untracked types (e.g. only `WebSite`) is **not**
  not-applicable under this feature, since it now gets a "not tracked" row; only a page with zero
  parseable JSON-LD blocks at all is not-applicable. This is the concrete behavioral consequence of
  the "show untracked types" decision above, worth Gate 1 double-checking it's actually wanted.
- **`FAQPage`/`HowTo` case**: reported as currently unsupported (per the restricted-eligibility
  ruleset data shipped in `structured-data-remaining-types`), same wording the existing eligibility
  rows already use — this feature doesn't change what the data says, only where/how it's presented.

## Gatherer needs

- New gatherer required: **no**. Reuses the existing `StructuredDataJsonLd` gatherer, same as both
  existing structured-data audits.
- New rule-engine/ruleset content: **no**. Calls the existing `resolveEligibilityRuleset()` +
  `eligibilityEngine.evaluate()` exactly as `structured-data-schema-properties` already does — this
  feature is entirely about a new *audit* (report presentation), not new *rule* content. If it turns
  out a genuinely different data shape is needed (e.g. aggregating by type across blocks rather than
  per-block rows), that's a decision for Agent 01, not decided here.

## Scope

- Package(s) affected: `packages/seo-audits`
- New audit, separate from `structured-data-schema-properties` and `structured-data-json-ld` — all
  three consume the same `StructuredDataJsonLd` gatherer artifact independently, per this package's
  established pattern.
- Out of scope (explicitly):
  - Any change to the tracked-type list, required-property rules, or eligibility data itself — this
    feature only re-presents data the rule engine already resolves.
  - Any change to `structured-data-schema-properties`'s existing eligibility rows — they stay exactly
    as they are; this is an additive, separate audit, not a migration.
  - Duplicate/conflicting `@type` detection (roadmap feature #3) — depends on this feature existing,
    but is a separate feature with its own spec.

## Open questions (for Agent 01 to resolve during design)

All three Gate-0-level questions (build vs. close, report shape, untracked-type handling) are
decided above (2026-09-29). Remaining for Agent 01:

- **Grouping key for untracked types**: should every distinct untracked `@type` string get its own
  row (e.g. separate rows for `WebSite` and `Thing`), or should all untracked types collapse into one
  generic "other/untracked markup found" row? The former is more informative; the latter avoids an
  unbounded table if a page has many distinct schema.org types Google simply doesn't cover. Agent 01
  should pick one and justify it against a real-world page's likely JSON-LD variety.
- **Audit id and title**: needs a concrete name distinct from `structured-data-schema-properties`
  (working name in this spec: `structured-data-rich-result-eligibility`) — confirm no collision with
  Lighthouse core or the two existing audits, per the standard upstream-sync check.
