# Task sequence: Remaining Rich-Result Types for Schema Property Validation

- slug: structured-data-remaining-types

Every task's `scope_whitelist` stays inside `packages/seo-audits`. No task reaches into
`packages/utils`/`packages/cli` — confirmed against `.ai-agents/prompts/monorepo-rules.md`, nothing
here needs an extension point that doesn't already exist.

New ruleset version: `2026-10` (next calendar version after `2026-09`, per the rule engine's
versioning convention). `current.json` for `google/structured-data` and `eligibility` stays pointed
at `2026-09` until task-07 — earlier tasks build up the `2026-10` file without making it live, so
intermediate commits never leave the resolved-`current` ruleset in a half-populated state.

## Tasks

### task-01: `2026-10` ruleset skeleton — carry forward `Product`/`Article`

- scope_whitelist: [packages/seo-audits/rules/google/structured-data/2026-10.json, packages/seo-audits/rules/eligibility/2026-10.json]
- depends_on: none
- description: Create both new version files with `version: "2026-10"` and the existing
  `Product`/`Article` entries copied byte-for-byte from `2026-09.json` (no content change — this
  task only establishes the file exists and passes its schema, so every following task is a small,
  additive diff instead of one huge new-file commit). `current.json` in both namespaces is **not**
  touched here.
- commit_message: "feat(seo-audits): add 2026-10 ruleset skeleton carrying Product and Article forward"

### task-02: Add `BreadcrumbList`, `Organization`, `LocalBusiness`

- scope_whitelist: [packages/seo-audits/rules/google/structured-data/2026-10.json, packages/seo-audits/rules/eligibility/2026-10.json]
- depends_on: task-01
- description: Per `docs/audit-specs/structured-data-remaining-types.md`'s table —
  `BreadcrumbList`: required `itemListElement`, nested `itemListElement` → required
  `position`,`name`,`item`. `Organization`: required `name`,`url`,`logo`, no nesting. `LocalBusiness`:
  required `name`,`address`, nested `address` → required `streetAddress`,`addressLocality`.
  Eligibility: all three `supported: true` with the audit spec's exact `richResultFeature` strings.
- commit_message: "feat(seo-audits): add BreadcrumbList, Organization, and LocalBusiness ruleset data"

### task-03: Add `Recipe`, `Review`

- scope_whitelist: [packages/seo-audits/rules/google/structured-data/2026-10.json, packages/seo-audits/rules/eligibility/2026-10.json]
- depends_on: task-02
- description: `Recipe`: required `name`,`image`,`author`,`recipeIngredient`,`recipeInstructions`,
  no nesting (per the audit spec, `aggregateRating`/`nutrition`/`video` deliberately left out —
  don't add them without a Gate 2 note if reviewer wants them included). `Review`: required
  `itemReviewed`,`author`,`reviewRating`, nested `itemReviewed`→required `name`, `author`→required
  `name`, `reviewRating`→required `ratingValue`. Eligibility: both `supported: true`.
- commit_message: "feat(seo-audits): add Recipe and Review ruleset data"

### task-04: Add `Event`, `JobPosting`

- scope_whitelist: [packages/seo-audits/rules/google/structured-data/2026-10.json, packages/seo-audits/rules/eligibility/2026-10.json]
- depends_on: task-03
- description: `Event`: required `name`,`startDate`,`location`, nested `location`→required
  `name`,`address` (per audit spec, `offers`/`eventAttendanceMode`/`eventStatus` deliberately left
  out). `JobPosting`: required `title`,`description`,`datePosted`,`hiringOrganization`,`jobLocation`,
  nested `hiringOrganization`→required `name`, `jobLocation`→required `address` (`validThrough`
  deliberately left out). Eligibility: both `supported: true`.
- commit_message: "feat(seo-audits): add Event and JobPosting ruleset data"

### task-05: Add `VideoObject`, `HowTo`

- scope_whitelist: [packages/seo-audits/rules/google/structured-data/2026-10.json, packages/seo-audits/rules/eligibility/2026-10.json]
- depends_on: task-04
- description: `VideoObject`: required `name`,`description`,`thumbnailUrl`,`uploadDate`, no nesting.
  `HowTo`: required `name`,`step`, nested `step`→required `text`. Eligibility: both `supported: true`.
- commit_message: "feat(seo-audits): add VideoObject and HowTo ruleset data"

### task-06: Add `FAQPage` (isolated — accepted shallow-nesting gap + restricted eligibility)

- scope_whitelist: [packages/seo-audits/rules/google/structured-data/2026-10.json, packages/seo-audits/rules/eligibility/2026-10.json]
- depends_on: task-05
- description: `FAQPage`: required `mainEntity`, nested `mainEntity`→required `name`,`acceptedAnswer`.
  This is the one type where the audit spec explicitly accepted a known gap — the engine can't check
  `acceptedAnswer.text` (two levels deep), so don't try to work around it here with different data
  shape; the shallow check is the documented, reviewed behavior. Eligibility: `supported: false` —
  per the audit spec, Google restricts FAQ rich results to a narrow authoritative-site category, and
  the current boolean schema can't express "restricted," so `false` is the closer approximation, not
  a data-entry mistake. Kept in its own commit specifically so this reasoning is easy to find in
  `git log`/`git blame`, separate from the other nine types' unremarkable entries.
- commit_message: "feat(seo-audits): add FAQPage ruleset data with restricted eligibility"

### task-07: Bump `current.json` to `2026-10`

- scope_whitelist: [packages/seo-audits/rules/google/structured-data/current.json, packages/seo-audits/rules/eligibility/current.json]
- depends_on: task-06
- description: Point both namespaces' `current.json` at `2026-10`. This is the one-line change that
  makes all 12 types (not just `Product`/`Article`) live for anything resolving `current` — including
  the existing `structured-data-schema-properties` audit, unchanged code, and the existing
  `structured-data-json-ld`/schema-org migration from the prior feature (unaffected — schema-org
  namespace isn't touched by this feature at all, still resolves its own separate `current.json`).
- commit_message: "feat(seo-audits): promote 2026-10 as the current google-requirements and eligibility ruleset"

### task-08: Update existing registry test for the 12-type reality

- scope_whitelist: [packages/seo-audits/test/rule-engine/registry.test.js]
- depends_on: task-07
- description: `registry.test.js`'s `'resolves the current schema-org, google-requirements, and
  eligibility rulesets'` test (confirmed at read-time: lines 48-71) hardcodes
  `expect(Object.keys(google.types).sort()).toEqual(['Article', 'Product'])` and only asserts
  `eligibility.types.Product`/`Article`. This **will** fail the moment task-07 lands without this
  task — not a hypothetical, confirmed by reading the assertion directly. Update the expected keys
  list to all 12 types (sorted), and add assertions for at least one newly-added type's `nested`
  shape (e.g. `BreadcrumbList.itemListElement`) and the `FAQPage`/`HowTo` `supported: false` cases,
  so the restricted-eligibility decision from task-06 has explicit test coverage, not just a comment.
  The generic schema-validation test (same file, lines 73-107) needs no change — it already
  `readdirSync`s the rules directory, so `2026-10.json` is picked up automatically.
- commit_message: "test(seo-audits): update registry test for the 12 tracked schema types"

### task-09: Fixture tests for the 10 new types through the existing audit

- scope_whitelist: [packages/seo-audits/test/audits/structured-data-schema-properties.test.js]
- depends_on: task-07
- description: Extend the existing test file (same shell-out-to-real-node pattern already
  established there) with mock-artifact cases: at minimum one pass and one fail case each for
  `BreadcrumbList`, `Recipe`, `Event`, `JobPosting`, `FAQPage` (representative spread across flat vs.
  nested vs. array-nested vs. the restricted-eligibility type — not all 10 need full pass/fail pairs,
  but every distinct *shape* introduced by tasks 02-06 needs at least one case exercising it). Confirm
  `Product`/`Article`'s existing test cases are unchanged and still pass, proving this feature didn't
  regress the two already-shipped types.
- commit_message: "test(seo-audits): add fixture tests for the 10 newly tracked schema types"

### task-10: Package README update

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-08, task-09
- description: Update the `structured-data-schema-properties` section to list all 12 tracked types
  (not "v1: Product, Article"). Add a short note on the two documented v1 limitations so a future
  reader doesn't mistake either for an oversight: (1) nested-property checks are one level deep only
  (names `FAQPage.acceptedAnswer.text` as the concrete example), (2) `FAQPage`/`HowTo` are reported
  as eligibility-`false` because Google restricts them to a narrow site category the current
  eligibility schema can't otherwise express.
- commit_message: "docs(seo-audits): document all 12 tracked schema types in the package README"

<!-- Every ruleset-data task (02-06) touches the same two files as its neighbors — this is
intentional serial dependency, not parallelizable, so each diff stays small and independently
reviewable rather than one large multi-hundred-line JSON commit. -->
