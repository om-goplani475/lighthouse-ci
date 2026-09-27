# Task sequence: Structured Data (JSON-LD) Validation Audit

- slug: structured-data-validation

## Tasks

### task-01: Scaffold `@lhci/seo-audits` package + shared types

- scope_whitelist: [packages/seo-audits/package.json, packages/seo-audits/src/types.js]
- depends_on: none
- description: Create `packages/seo-audits/package.json` (`name: "@lhci/seo-audits"`,
  `type: "module"`, `main: "src/lighthouse-config.js"` per the corrected contract — no build step,
  no dependencies beyond `lighthouse` as a peer/declared dep since it's resolved from the workspace
  root). Create `packages/seo-audits/src/types.js` with the JSDoc `@typedef`s from the (corrected)
  feature contract: `StructuredDataJsonLdEntry`, `StructuredDataJsonLdArtifact`,
  `StructuredDataBlockResult`. Plain `.js`, ESM `export {}`, no `.ts` file (confirmed `tsconfig.json`
  doesn't glob `.ts` under `packages/*/src`).
- commit_message: "feat(seo-audits): scaffold @lhci/seo-audits package with shared types"

### task-01b: ESLint ESM override for `packages/seo-audits` — **flagged, discovered during implementation, touches outside `packages/seo-audits`**

- scope_whitelist: [.eslintrc.js]
- depends_on: task-01
- **Flag**: not anticipated at `/sequence-tasks` time. Root `.eslintrc.js` hard-codes
  `parserOptions.sourceType: 'script'` (CommonJS) globally, with `strict: ['error', 'global']`
  requiring a `'use strict'` pragma. `packages/seo-audits` is genuinely ESM (`"type": "module"`,
  required by Lighthouse's own loader per the feature contract) — every other package here is CJS,
  so this is the first package that needs different lint parsing. Caught when `npm run test:lint:js`
  failed on `packages/seo-audits/src/types.js` for missing a `'use strict'` pragma that doesn't apply
  to ES modules (implicitly strict already). Approved by developer as its own separate task rather
  than folding into task-01, to keep "scaffold the package" and "change shared lint config" as
  distinct, reviewable commits.
- description: Add an `overrides` entry to `.eslintrc.js` scoped to `files: ['packages/seo-audits/**/*.js']`
  setting `parserOptions.sourceType: 'module'` and `rules: {strict: 'off'}`. Scoped narrowly — doesn't
  change linting behavior for any other package.
- commit_message: "chore(lint): allow ESM sourceType for packages/seo-audits"

### task-02: Implement the `StructuredDataJsonLd` gatherer

- scope_whitelist: [packages/seo-audits/src/gatherers/structured-data-json-ld.js]
- depends_on: task-01
- description: `BaseGatherer` subclass (import from `lighthouse/core/gather/base-gatherer.js`,
  matching `MetaElements`'s own import shape). `getArtifact` evaluates
  `document.querySelectorAll('script[type="application/ld+json"]')` in-page and returns
  `{content: node.textContent, node: getNodeDetails(node)}[]`. Reuse
  `pageFunctions.getNodeDetails` from `lighthouse/core/lib/page-functions.js` (confirmed exported,
  same function `MetaElements` uses) — do not reimplement node-detail extraction, per the audit
  spec's resolved item. `supportedModes: ['snapshot', 'navigation']`.
- commit_message: "feat(seo-audits): add structured-data-json-ld gatherer"

### task-03: Implement the `structured-data-json-ld` audit

- scope_whitelist: [packages/seo-audits/src/audits/structured-data-json-ld.js]
- depends_on: task-02
- description: `Audit` subclass (import from `lighthouse/core/audits/audit.js`). `meta.id:
  'structured-data-json-ld'`, `requiredArtifacts: ['StructuredDataJsonLd']`. Scoring exactly per
  `docs/audit-specs/structured-data-validation.md`: zero blocks → score 0; per-block
  `JSON.parse` + `@context`/`@type` presence check; any invalid block → score 0. `details`: `table`
  DetailsType, rows = `StructuredDataBlockResult[]` (`index, valid, reason, snippet`).
- commit_message: "feat(seo-audits): add structured-data-json-ld audit"

### task-04: Fixture tests for the audit

- scope_whitelist: [packages/seo-audits/test/audits/structured-data-json-ld.test.js, packages/seo-audits/test/fixtures/structured-data/*.html]
- depends_on: task-03
- description: Per `.ai-agents/prompts/testing-patterns.md`, test the audit function directly against
  static fixtures (no live Lighthouse run needed for this level): valid single block; valid multiple
  blocks; missing entirely (zero blocks); malformed JSON; valid JSON missing `@context`/`@type`; one
  valid + one invalid block on the same page (confirms per-block reporting, not just aggregate
  pass/fail). Six fixtures minimum, matching the feature spec's documented cases.
- commit_message: "test(seo-audits): add fixture tests for structured-data-json-ld audit"

### task-05: Wire into custom Lighthouse config + `extends` regression test

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-04
- description: `lighthouse-config.js` per the verified Extension point in the audit spec —
  `extends: 'lighthouse:default'`, new `artifacts` entry for the gatherer, new `audits` entry, new
  `categories.seo-extended`. The regression test resolves this config through Lighthouse's own
  `initializeConfig` (exported from `lighthouse/core/config/config.js`, confirmed real and usable
  directly) and asserts the resolved config's audits still include core defaults (`meta-description`,
  `document-title`) **and** `structured-data-json-ld` — this is the concrete test the audit spec's
  "Resolved for Agent 04" section calls for, not just a manual check.
- commit_message: "feat(seo-audits): wire structured-data-json-ld into custom lighthouse config"

### task-06: Assertion preset severities — **reverted during implementation**

- **Correction (caught while implementing, not anticipated at `/sequence-tasks` or
  `/design-contract` time)**: attempted the edit described below, then found it breaks a
  pre-existing invariant enforced by `packages/utils/test/presets.test.js` — that test dynamically
  imports `lighthouse` and asserts every audit id referenced in `all.js`/`recommended.js`/`no-pwa.js`
  is one of Lighthouse's own default audits. `structured-data-json-ld` is never part of Lighthouse's
  default config (it only exists when a consumer opts into `configPath`), so adding it to the shared
  presets fails that test — the first time any fork-specific opt-in audit has hit this, since this
  fork never added its own audit before this feature.
- **Decision**: revert the preset edits entirely rather than weaken `presets.test.js` with an
  allowlist exception. Assertion severity for `structured-data-json-ld` is left to the consumer's own
  `.lighthouserc.js` (documented in task-07's README) — `packages/utils/src/presets/` stays untouched.
  Original description, kept for the record: add `'structured-data-json-ld': ['error', {}]` to
  `all.js` and `['warn', {}]` to `recommended.js`. Not implemented.
- No commit for this task.

### task-07: Package README

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-06
- description: Short README — what this package is, the `configPath` wiring a consumer needs to add
  to their own `.lighthouserc.js`, and a link to `docs/feature-specs/structured-data-validation.md`
  for the full rationale. Minimal — full QA/changelog docs are handled by Agents 06/09 post-merge, not
  this task.
- commit_message: "docs(seo-audits): add package README"
