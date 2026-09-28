# Audit spec: Remaining Rich-Result Types for Schema Property Validation

- slug: structured-data-remaining-types
- upstream-sync checked against: lighthouse@12.6.1 (unchanged since `structured-data-rule-engine`,
  confirmed via `node_modules/lighthouse/package.json`; no upstream pull has landed in between —
  `git log` shows no `node_modules` or lockfile commits since that feature). No API drift to
  account for. This feature doesn't touch audit/gatherer code at all (see below), so the
  extension-point/LHR-shape checks in `upstream-sync.md` don't materially apply, but were run
  anyway per the checklist rather than skipped as "obviously fine."

## Gatherer

- New gatherer: none (reusing: `StructuredDataJsonLd`,
  `packages/seo-audits/src/gatherers/structured-data-json-ld.js`) — unchanged from the parent
  feature.

## Audit

- Audit id: `structured-data-schema-properties` (existing audit, **no code changes** — confirmed
  by reading `packages/seo-audits/src/audits/structured-data-schema-properties.js`:83, which keys
  entirely off `googleRuleset.types[schemaType]` with no type-specific branching anywhere in the
  audit or either engine it calls).
- Scoring function: unchanged — `score = Number(!anyRequirementFailure)` across all tracked-type
  blocks on the page; eligibility findings never affect score.
- `DetailsType`: unchanged — `table`, same 5 columns.
- **What this spec actually designs**: not code, but the ruleset *data* — the per-type
  required-property lists and nested-path definitions Agent 03/04 will add to
  `rules/google/structured-data/{new-version}.json`, and the per-type support flags added to
  `rules/eligibility/{new-version}.json`.

### Engine capability check (the key design risk for this feature)

Before trusting "ruleset-data-only," I read `google-requirements-engine.js`:47-65. Its `nested`
mechanism already handles **both** a single nested object and an **array of nested objects**
(`asObjectArray` at line 17 normalizes either shape) — so array-valued properties like
`BreadcrumbList.itemListElement` or `FAQPage.mainEntity` fit the existing mechanism without any
engine change. Confirmed: **all 10 remaining types can be expressed as data**, no engine work
needed. This was a real risk (not assumed) — array-shaped nested properties are common among the
remaining 10 but didn't exist in the `Product`/`Article` precedent, so it needed checking, not
inheriting.

**One real limitation found and accepted, not silently worked around**: the engine only checks
one level of nesting (a nested instance's *direct* properties) — it does not recurse into a
nested property's own nested properties. This matters for exactly one case below:
`FAQPage.mainEntity[].acceptedAnswer` — Google's actual guidance wants that `Answer` object to
itself contain `text`, but the engine can only verify `acceptedAnswer` is *present*, not that its
`.text` is. Extending the engine to arbitrary-depth recursion is explicitly out of scope per the
feature spec's "not a generic recursive validator" principle — so FAQPage's check is intentionally
shallower than Google's full requirement. Documented here so it's a reviewed decision, not a gap
discovered later.

### Per-type ruleset data (Google requirements namespace)

Sourced from Google's published structured-data guidelines as currently known (no live fetch —
same drift-risk caveat the original intake flagged, worse here because 10 types is more surface
than 2). Per the feature's severity model, required and recommended are folded into one `required`
list; where I folded in a *recommended* property because Google's own docs frame it as
meaningfully tied to eligibility (not just "nice to have"), it's marked `(recommended→required)` —
that framing is a judgment call for gate review, not a settled fact.

| Type | `required` | `nested` |
|---|---|---|
| `FAQPage` | `mainEntity` | `mainEntity` → `Question`, required: `name`, `acceptedAnswer` (shallow — see limitation above) |
| `HowTo` | `name`, `step` | `step` → `HowToStep`, required: `text` |
| `BreadcrumbList` | `itemListElement` | `itemListElement` → `ListItem`, required: `position`, `name`, `item` |
| `Recipe` | `name`, `image`, `author`, `recipeIngredient`, `recipeInstructions` | none |
| `Review` | `itemReviewed`, `author`, `reviewRating` | `itemReviewed` → required: `name`; `author` → required: `name`; `reviewRating` → `Rating`, required: `ratingValue` |
| `Event` | `name`, `startDate`, `location` | `location` → `Place`, required: `name`, `address` |
| `JobPosting` | `title`, `description`, `datePosted`, `hiringOrganization`, `jobLocation` | `hiringOrganization` → `Organization`, required: `name`; `jobLocation` → `Place`, required: `address` |
| `VideoObject` | `name`, `description`, `thumbnailUrl`, `uploadDate` | none |
| `Organization` | `name`, `url`, `logo` (recommended→required: `logo` is Google-recommended, folded in because it's the specific field the Organization/knowledge-panel logo result reads) | none |
| `LocalBusiness` | `name`, `address` | `address` → `PostalAddress`, required: `streetAddress`, `addressLocality` |

**Deliberately left out of `required`** (real Google-recommended properties not folded in, to
avoid over-claiming confidence): `Recipe.aggregateRating`/`nutrition`/`video`,
`Event.offers`/`eventAttendanceMode`/`eventStatus`, `JobPosting.validThrough`. These are common
enough in practice that most real-world markup won't have all of them; folding them into a hard
`required` list risks the audit failing typical valid pages more than it risks missing a real gap.
Flagging for gate review rather than deciding unilaterally — Agent 02/03 should treat this table as
the concrete list to implement unless Gate 1 pushes back on a specific row.

### Per-type ruleset data (eligibility namespace)

| Type | `supported` | `richResultFeature` |
|---|---|---|
| `FAQPage` | **false** | n/a — see note below |
| `HowTo` | **false** | n/a — see note below |
| `BreadcrumbList` | true | "Breadcrumb rich results" |
| `Recipe` | true | "Recipe rich results" |
| `Review` | true | "Review snippet" |
| `Event` | true | "Event rich results" |
| `JobPosting` | true | "Job posting rich results" |
| `VideoObject` | true | "Video rich results" |
| `Organization` | true | "Organization knowledge panel logo" |
| `LocalBusiness` | true | "Local business rich results" |

**`FAQPage`/`HowTo` marked `supported: false` deliberately, not an oversight**: Google
significantly restricted eligibility for FAQ and HowTo rich results to a narrow set of
authoritative/government/health sites (a real policy change, not a hypothetical — this is the
concrete case the intake's "drift risk" caveat was warning about in the abstract). The current
`EligibilityRuleSet` schema only models a boolean `supported` + one message template
(`eligibility-engine.js`:21-25) — it can't express "supported, but restricted to a narrow site
category," which is the actually-accurate state. Marking `false` produces the message "not
currently documented as supported for a Google rich result," which is closer to true for a typical
site than `true` would be, but it's a real information loss either way.

**Open question for Gate 1, not resolved here**: should the eligibility ruleset schema gain a
third state (e.g. `supported: 'restricted'` with a `note` field) to express this accurately,
before this ships? That's a schema change (touches `types.js`, `eligibility-engine.js`, and the
JSON Schema in `rules/schema/`), which would make this feature *not* purely ruleset-data-only for
the `eligibility` namespace specifically (the `google-requirements` namespace stays data-only
either way). Recommend deciding this at Gate 1 rather than deferring silently — going with the
boolean approximation now is a reasonable v1 call, but it should be a reviewed one.

## Category placement

Unchanged — `seo-extended` category, same audit already registered at weight 1. No change needed.

## Extension point

Unchanged — `packages/seo-audits/src/lighthouse-config.js`'s `configPath` mechanism, already
registered for this audit id. No new registration needed.

## Risks / open questions

- **Eligibility schema gap for `FAQPage`/`HowTo`** (see above) — needs a Gate 1 decision: ship the
  boolean approximation, or extend the eligibility schema first. My recommendation: ship the
  approximation now (it's informational-only, never affects score, and is strictly better than
  omitting these two types from eligibility reporting entirely) and track the schema extension as
  a separate, smaller future feature if it turns out to matter in practice.
- **Property-list confidence varies by type**: high confidence on `VideoObject`, `Organization`,
  `LocalBusiness`, `BreadcrumbList` (stable, narrow Google docs). Lower confidence on
  `Recipe`/`Event`/`JobPosting`'s exact required/recommended boundary — Google's own docs hedge
  more here and change more often. Agent 04 should treat the table above as the spec to implement,
  but this is the part most likely to need a follow-up ruleset version if it's found to be wrong
  in practice.
- **`FAQPage` shallow-nesting gap** (see Engine capability check above) — accepted, documented,
  not a blocker, but worth a one-line note in the audit's own description or README so a future
  reader doesn't mistake it for an oversight.
- **Task sequencing**: per the feature spec's own flag, Agent 03 should split by type/type-group
  (2-3 per task) across both ruleset files plus the version-manifest bump, not one giant commit.
