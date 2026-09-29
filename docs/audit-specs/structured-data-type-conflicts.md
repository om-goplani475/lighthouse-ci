# Audit spec: Duplicate and Conflicting `@type` Detection

- slug: structured-data-type-conflicts
- upstream-sync checked against: lighthouse@12.6.1 (unchanged since the last two features —
  confirmed via `node_modules/lighthouse/package.json`, no `node_modules`/lockfile commits since).

**Gate 0 decisions confirmed here** (both asked as blocking questions before this design, per
`.ai-agents/prompts/blocking-questions.md`):
- Entity matching uses **strong identity fields only** — a block with no identity field for its type
  is never compared for conflicts, not even via a name-only fallback.
- Singular-type list is **`Organization`, `WebSite`, `BreadcrumbList`**.

## Gatherer

- New gatherer: none (reusing: `StructuredDataJsonLd`) — same artifact all three existing
  structured-data audits consume.

## New rule-engine namespace: `type-conflicts`

Following this package's established pattern (versioned data, not hardcoded logic — see
`docs/architecture/structured-data-rule-engine.md`) rather than a one-off exception for this
feature:

- `rules/type-conflicts/{version}.json` + `current.json`, resolved via a new
  `resolveTypeConflictsRuleset()` in `registry.js` (mirrors the three existing `resolve*Ruleset`
  functions exactly).
- New JSON Schema: `rules/schema/type-conflicts-ruleset.schema.json`.
- New typedef in `rule-engine/types.js`: `TypeConflictsRuleSet` (see contract for the exact shape).
- New pure-function engine: `rule-engine/type-conflicts-engine.js`, two exported functions
  (`findDuplicates`, `findConflicts` — kept separate, not one combined function, since they operate
  on different inputs and have different false-positive-risk profiles; conflating them would make it
  harder to keep the "duplicate-count is scored, conflicting-entity is informational" distinction
  clean at the audit layer).
- `FindingNamespace` typedef (in `rule-engine/types.js`) gains two new values:
  `'duplicate-count' | 'conflicting-entity'` — additive to the existing
  `'schema-org' | 'google-requirements' | 'eligibility'` union, not a replacement.

### Ruleset content (v1)

```json
{
  "version": "2026-10",
  "singularTypes": ["Organization", "WebSite", "BreadcrumbList"],
  "identityFields": {
    "Product": ["sku", "gtin", "gtin13", "gtin8", "mpn"],
    "Organization": ["url"],
    "LocalBusiness": ["url"],
    "Event": ["url"],
    "VideoObject": ["contentUrl", "embedUrl", "url"],
    "Recipe": ["url"],
    "Article": ["url"],
    "JobPosting": ["url"]
  }
}
```

`identityFields` deliberately has **no entry** for `Review`, `FAQPage`, `HowTo`, `BreadcrumbList` —
these don't have a natural, unambiguous per-block identity signal in schema.org's model (a `Review`
is an assertion, not an entity with its own identity; `FAQPage`/`HowTo`/`BreadcrumbList` are
structural/container types). Per the Gate 0 decision, a type with no `identityFields` entry is never
compared for conflicts — confirmed in `type-conflicts-engine.js`'s `findConflicts`, not left to fall
through to an unintended default. `url` appears in most lists as a generic fallback since it's a
common schema.org `Thing` property available on nearly any type, checked after more specific
fields — e.g. `Product` checks `sku`/`gtin`/`mpn` first since those are stronger identity signals
than a possibly-generic `url`.

## Audit

- Audit id: `structured-data-type-conflicts`. Confirmed no collision via the same grep pattern used
  for the prior feature's audit id.
- **Two independent checks, two different scoring treatments** (per the Gate 0 decision):

  **`findDuplicates(groupedByType, ruleset)`** — pure function, input is the same
  `Map<type, count>`-shaped grouping `structured-data-rich-result-eligibility` already computes
  (this audit recomputes its own grouping rather than importing the sibling audit's internal
  function — audits stay independent, per this package's established pattern of each audit
  consuming the shared gatherer artifact directly, not depending on another audit's output). For
  each type in `ruleset.singularTypes` with `count > 1`, returns a `Finding`
  (`namespace: 'duplicate-count'`, `severity: 'error'`).

  **`findConflicts(blocksByType, ruleset)`** — for each type with an `identityFields` entry, group
  that type's *parsed* blocks (not just counts — need actual field values) by the first
  identity-field value each block has (checked in the ruleset's listed order; a block with none of
  the listed fields present is excluded from comparison entirely, not treated as a wildcard match).
  Within each identity-value group of 2+ blocks, compare all other top-level fields (excluding
  `@context`, `@type`, and whichever identity field matched) — if any field's value differs across
  the group, return a `Finding` (`namespace: 'conflicting-entity'`, `severity: 'info'`) naming the
  differing field and both values. **Top-level comparison only, not recursive/nested** — consistent
  with the rule engine's existing "not a generic recursive validator" principle
  (`google-requirements-engine.js`'s one-level `nested` handling is the precedent).

- **Scoring**: `score = Number(duplicateFindings.length === 0)` — only `duplicate-count` findings
  affect score. `conflicting-entity` findings are always included in `details` but never factored
  into `score`, mirroring exactly how `eligibility` findings never affect
  `structured-data-schema-properties`'s score. If there are zero blocks of any singular type *and*
  zero blocks of any identity-field-bearing type at all, return `{score: null, notApplicable: true}`
  — matches this package's established not-applicable convention (nothing to check, not "checked and
  found clean").
- `DetailsType`: `table`. Columns: `namespace` (text — `duplicate-count` or `conflicting-entity`,
  keeps the two kinds visually distinct in the report, same pattern
  `structured-data-schema-properties` already uses for its two namespaces), `type` (text), `detail`
  (text — count-and-type for duplicates, e.g. "3 Organization blocks found (expected at most 1)";
  differing-field-and-values for conflicts, e.g. "offers.price differs: '9.99' vs '14.99'"),
  `message` (text — human-readable summary sentence).
- Stamp `details.rulesetVersions = {typeConflicts: ruleset.version}`.

## Category placement

- Category: `seo-extended` (existing), weight 1 — same category as all three existing
  structured-data audits.

## Extension point

Unchanged: `packages/seo-audits/src/lighthouse-config.js`'s `configPath`-based registration —
add to `audits` array and `categories['seo-extended'].auditRefs`.

## Risks / open questions

- **False positives on `conflicting-entity`, even with strong-identity-fields-only**: a legitimate
  page pattern — e.g. a `Product` block updated mid-day with a new price, where a caching layer
  serves a stale second copy of the same JSON-LD block with old data — would genuinely look like a
  conflict under this design. This is accepted as correct behavior (it *is* worth flagging, even if
  the cause is caching rather than a content mistake), but Agent 06 (QA) should verify the message
  wording doesn't overclaim certainty (e.g. "may indicate inconsistent data" rather than "this page
  has an error").
- **`identityFields` list is a v1 judgment call**, same caveat this package's other guideline-derived
  data always carries (see `structured-data-remaining-types`'s "lower confidence" note for
  `Recipe`/`Event`/`JobPosting`). Likely to need real-world tuning after this audit has run in
  practice — expect a future ruleset version, not a design flaw to fix now.
- **Performance**: `findConflicts` is O(n²) per identity-value group in the worst case (pairwise
  field comparison) — bounded by how many JSON-LD blocks a single page realistically has (this
  package's existing audits already accept the same bound from the shared gatherer artifact), not a
  new concern, but worth Agent 04 sanity-checking with a page that has an unusually large number of
  blocks of one type during fixture testing.
- **Task sequencing**: this feature is larger than `structured-data-rich-result-eligibility` (new
  ruleset namespace + schema + engine + audit + tests + docs, not audit-layer-only) — closer in
  shape to `structured-data-rule-engine`'s original task count. Agent 03 should sequence
  accordingly, not assume this is another "single audit file" feature.
