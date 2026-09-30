# QA: `structured-data-deprecated-properties` (Phase 2 item 6)

## What this is

A new, purely informational audit that reports usage of schema.org properties schema.org itself
has superseded with a newer property name. Scoped to the six schema types this fork already
validates most deeply via `google-requirements-engine.js`: `Product`, `Article`, `Event`,
`JobPosting`, `VideoObject`, `Review`. Two scope decisions were made via a blocking question before
any code was written:

- **Type scope**: the six google-requirements types, not all twelve tracked types and not a
  cross-type curated set — reuses existing per-type infrastructure, smallest footprint.
- **Scoring model**: purely informational (`scoreDisplayMode: informative`, `score` always `null`),
  like `structured-data-rich-result-eligibility` — a deprecated property usually still works and
  Google may still honor it, so flagging it as a hard failure would overstate the risk.

## Where the deprecation data came from

Not guessed or reconstructed from memory. Each type's own schema.org page
(`https://schema.org/{Type}`) marks a property with a `"Supersedes X"` note when it has replaced an
older property name; `X` is the deprecated one. Fetched each of the six type pages directly (not a
bulk CSV/JSON-LD export — an earlier attempt to bulk-extract schema.org's full properties CSV via
a single fetch produced an internally contradictory result, e.g. claiming `actor` is superseded by
`actors` *and* `actors` is superseded by `actor` in the same table, which a direct page fetch
resolved unambiguously as `actor` supersedes `actors`, i.e. `actors` is the deprecated one — a real
reminder that a summarizing fetch over a large machine file can hallucinate rows, and a smaller,
directly-quoted per-page fetch is more trustworthy for data that will drive a shipped ruleset).

Filtered to properties realistic for a real page to actually emit for that type — some inherited
"Supersedes" notes were excluded as out of scope for a type's real-world usage (e.g. `VideoObject`
inherits a `temporalCoverage`/`datasetTimeInterval` note that is really `Dataset`-specific and not
something a page marking up video would plausibly write).

Final data set, `rules/schema-org-deprecations/2026-10.json`:

| Type | Deprecated property | Current property |
|---|---|---|
| Product | `serviceAudience` | `audience` |
| Product | `awards` | `award` |
| Product | `hasProductReturnPolicy` | `hasMerchantReturnPolicy` |
| Product | `reviews` | `review` |
| Article | `awards` | `award` |
| Event | `actors` | `actor` |
| Event | `attendees` | `attendee` |
| Event | `directors` | `director` |
| Event | `language` | `inLanguage` |
| Event | `performers` | `performer` |
| Event | `reviews` | `review` |
| Event | `subEvents` | `subEvent` |
| JobPosting | `incentives` | `incentiveCompensation` |
| JobPosting | `benefits` | `jobBenefits` |
| VideoObject | `actors` | `actor` |
| VideoObject | `awards` | `award` |
| VideoObject | `encodings` | `encoding` |
| VideoObject | `fileFormat` | `encodingFormat` |
| VideoObject | `language` | `inLanguage` |
| VideoObject | `interactionCount` | `interactionStatistic` |
| VideoObject | `free` | `isAccessibleForFree` |
| VideoObject | `isBasedOnUrl` | `isBasedOn` |
| VideoObject | `reviews` | `review` |
| Review | *(none found specific to Review's own property table)* | — |

`Review` is intentionally present in the ruleset with an empty `deprecated` map rather than omitted
— makes explicit that it was checked and had nothing to report, not skipped.

## What was built

- `rules/schema-org-deprecations/2026-10.json` + `current.json`, schema-validated by
  `rules/schema/schema-org-deprecations-ruleset.schema.json` (same versioned-ruleset pattern as
  every other namespace).
- `src/rule-engine/schema-org-deprecations-engine.js` — pure `evaluate(schemaType, data, ruleset)`,
  checks only the entity's own top-level properties (not nested sub-objects — same narrow-first
  scoping `google-requirements-engine.js`'s datatype checks use), returns `info`-severity
  `deprecated-property`-namespace findings.
- `src/audits/structured-data-deprecated-properties.js` — new audit, template-matched to
  `structured-data-rich-result-eligibility.js`: uses `extractTypedEntities` (so `@graph` containers
  and `@id`-resolved references are understood for free, same as every other structured-data audit
  since Phase 2 item 5), `notApplicable` only when none of the six types appear at all.
- `types.js`: new `deprecated-property` `FindingNamespace` value, new `SchemaOrgDeprecationsRuleSet`
  typedef.
- `registry.js`: new `resolveSchemaOrgDeprecationsRuleset`.
- `lighthouse-config.js`: registered as the sixteenth audit, added to the `seo-extended` category.
- Tests: `test/rule-engine/schema-org-deprecations-engine.test.js` (5 cases: untracked type,
  property absent, tracked type with empty map, property present, severity always `info`);
  `test/audits/structured-data-deprecated-properties.test.js` (6 cases, same shell-out-to-real-node
  pattern as the sibling audits' tests since this audit transitively imports `registry.js`: not
  applicable with no tracked type, zero rows on clean markup, a deprecated property flagged with
  correct block/type/property/message, always-null score, `rulesetVersions` stamp, `@graph`
  unwrapping); `test/lighthouse-config.test.js` updated (fifteen → sixteen audits).

## Verified live (real `lhci collect`)

Two local fixtures served via `python3 -m http.server`, both a `Product` with an `offers` block:

- `index.html` — `reviews: [...]` (deprecated plural form).
- `clean.html` — `review: {...}` (current singular form).

Ran `lhci collect` against each with `src/lighthouse-config.js` as `configPath`, then read the
resulting LHR's `structured-data-deprecated-properties` audit directly:

- [x] `index.html`: `details.items` contains exactly one row —
  `{blockIndex: 0, type: "Product", property: "reviews", message: '"reviews" is a deprecated
  schema.org property (as of ruleset 2026-10); use "review" instead.'}`. `score: 1`,
  `scoreDisplayMode: "informative"`, `details.rulesetVersions: {schemaOrgDeprecations: "2026-10"}`.
- [x] `clean.html`: `details.items` is `[]` — zero false positives on markup using only current
  property names. `score: 1`, `notApplicable` is not set (a tracked type was present, just clean).

Confirms the full path works end to end, not just against mocked artifacts: real JSON-LD parsing →
`@graph`/`@id` unwrapping → entity extraction → deprecation lookup → report row, with a real
Lighthouse audit run producing the exact shape the unit tests assert.

## Full suite

`npm run test:typecheck` and `npm run test:lint` both clean. `npx jest packages/seo-audits`: 29
suites, 234 tests, all passing.
