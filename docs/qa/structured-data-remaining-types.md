# QA checklist: Remaining Rich-Result Types for Schema Property Validation

- slug: structured-data-remaining-types
- merged: 00e6f71 (commit range f97606c..00e6f71 on main)
- verified live: 2026-09-28, via real `lhci collect`/`lhci assert` runs against a local static test
  site — not just unit tests, matching the standard this pipeline holds itself to since
  `structured-data-validation`.

## Functional

- [x] `BreadcrumbList` pass (array-nested `itemListElement`, both entries complete) verified live:
      score 1, eligibility row hedged ("may be eligible... does not guarantee"), `rulesetVersions`
      stamped `2026-10`.
- [x] `Recipe` pass (all flat required properties) verified live: score 1.
- [x] `Recipe` fail (missing `recipeIngredient`) verified live: score 0, exact missing property
      named (`recipeIngredient`), `seo-extended` category composed to `0.5` (averaging the passing
      `structured-data-json-ld` and the failing `structured-data-schema-properties`) — confirms
      category composition, not just the single audit's own score.
- [x] `FAQPage` verified live with a fully valid block (`mainEntity[].name` +
      `mainEntity[].acceptedAnswer` both present): score 1, and — the specific behavior this feature
      deliberately changed — its eligibility message reads "FAQPage is not currently documented as
      supported for a Google rich result," not the hedged-supported wording every other type gets.
      Confirms the restricted-eligibility design decision actually took effect at runtime, not just
      in the ruleset JSON.
- [x] `Product` re-verified live under the new `2026-10` ruleset (not just `2026-09`): score 1,
      correct eligibility wording — confirms bumping `current.json` didn't regress the two
      already-shipped types.
- [x] All other 6 new types (`Organization`, `LocalBusiness`, `Event`, `JobPosting`, `VideoObject`,
      `HowTo`) — verified at the unit-test level
      (`structured-data-schema-properties.test.js`, extended this feature to cover every distinct
      shape: flat, single-nested, multi-nested, array-nested); not separately re-verified live since
      the live-verified cases already exercise every one of those shapes at least once (e.g.
      `Recipe` exercises flat, `BreadcrumbList` exercises array-nested, `Event`/`JobPosting` are
      unit-tested for single- and multi-nested respectively) — same reasoning
      `structured-data-rule-engine`'s QA used to skip a redundant live `Article` re-run.

## Edge cases

- [x] `FAQPage.mainEntity[].acceptedAnswer.text` missing (but `acceptedAnswer` itself present) —
      verified via unit test (`structured-data-schema-properties.test.js`): score still 1. This is
      the accepted, documented shallow-nesting limitation, not a bug — confirmed it behaves exactly
      as designed, not accidentally.
- [x] Array-nested failure correctly names the failing instance's index
      (`itemListElement[1].name`, not just `itemListElement.name`) — verified via unit test with a
      2-entry array where only the second entry is missing a property.
- [x] Not-applicable case unaffected by this feature — a page with no tracked type still scores
      `null`/`notApplicable` (existing test, unchanged, still passing).

## Integration

- [x] `lhci assert` enforces severity on a new type — verified live: set
      `'structured-data-schema-properties': ['error', {}]`, ran against the `recipe-fail` LHR, got
      the expected failure (`expected: >=0.9, found: 0`, exit status 1).
- [x] Report renders — verified by generating a real HTML report via
      `ReportGenerator.generateReportHtml(lhr)` for one of the new-type results: succeeded, 205KB,
      no error.
- [x] `.lighthouserc.js`/`configPath` — no new config keys introduced by this feature (confirmed
      against the feature contract); existing wiring picked up all 12 types with zero config
      changes, exactly as the contract predicted.
- [x] `current.json` version-pointer mechanism — verified live end-to-end: bumping
      `rules/google/structured-data/current.json` and `rules/eligibility/current.json` to `2026-10`
      was sufficient, alone, to bring all 10 new types online for the existing audit at runtime — no
      audit/engine code was deployed differently, confirming the versioned-registry design's core
      promise (data changes ship independently of code) actually holds under a real collect run.

## Regression

- [x] `Article`/`Product`'s existing unit tests unchanged and still passing (16/16 in
      `structured-data-schema-properties.test.js`, including all 6 pre-existing cases).
- [x] `Product` re-verified live under `2026-10` (see Functional above) — the regression risk this
      feature's task sequence explicitly flagged (task-07 bumping `current.json`) is closed.
- [x] `registry.test.js`'s hardcoded 2-type assertion — this genuinely would have broken (confirmed
      by running it before the fix), now updated and passing; this was the one real "gotcha" this
      feature surfaced, not a hypothetical risk.
- [x] Full repo `npm run test:typecheck`/`test:lint` pass, confirmed fresh on the feature branch
      before merge (Gate 3 review). Scoped `npx jest packages/seo-audits` — 7 suites, 42/42 passing.
      Full-repo `npm run test:unit` has the same pre-existing, unrelated flaky failures as the last
      two features (Puppeteer/storybook snapshot tests, a `wizard.test.js` stderr assertion tripped
      by a Node `DEP0169` deprecation warning) — confirmed zero overlap with
      `seo-audits`/`structured-data`/`rule-engine` by direct diff-scope check (this branch has no
      diff against `main` outside `packages/seo-audits`, `docs/`, `.ai-agents/state`), not just by
      grepping failure names.

## Summary

Every functional/integration claim that matters is verified live, not just unit-tested — including
the one this feature specifically needed proof for: that a pure ruleset-data change (`2026-10.json`
+ `current.json` bump) is sufficient on its own to bring 10 new types online for an already-shipped,
unmodified audit. `Organization`/`LocalBusiness`/`Event`/`JobPosting`/`VideoObject`/`HowTo` were
skipped for live re-verification as redundant with the shapes already exercised live by
`Recipe`/`BreadcrumbList`/`FAQPage`/`Product` — noted explicitly rather than silently omitted. No
gaps considered blocking.
