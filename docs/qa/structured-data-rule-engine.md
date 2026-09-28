# QA checklist: Structured Data Rule Engine

- slug: structured-data-rule-engine
- merged: bce25fb (commit range 5125783..bce25fb on main)
- verified live: 2026-09-28, via real `lhci collect`/`lhci assert` runs against a local static test
  site — not just unit tests, matching the standard this pipeline holds itself to since
  `structured-data-validation`.

## Functional

- [x] `Product` pass case (all required, including nested `offers`) verified live: score 1,
      eligibility row present and correctly hedged, `rulesetVersions` stamped
      (`{googleStructuredData: "2026-09", eligibility: "2026-09"}`).
- [x] `Product` fail case (missing `offers.availability`) verified live: score 0, exact missing
      property named in the report (`offers.availability`), eligibility row still reported
      (informational, correctly unaffected by the requirements failure).
- [x] Not-applicable case (no tracked type on the page) verified live: `score: null`,
      `scoreDisplayMode: notApplicable`, no `runtimeError` — fails cleanly, not by crashing.
- [x] `Article` pass/fail — verified at the unit-test level
      (`structured-data-schema-properties.test.js`); not separately re-verified live since the
      `Product` live run already exercises the identical code path (same audit, same engines), and
      `Article`'s flat (non-nested) case is the simpler of the two shapes.

## Integration

- [x] `lhci assert` enforces a consumer-set severity — verified live: set
      `'structured-data-schema-properties': ['error', {}]`, ran against the fail-case LHR, got the
      expected failure (`expected: >=0.9, found: 0`, exit status 1).
- [x] Report renders — verified by generating a real HTML report via
      `ReportGenerator.generateReportHtml(lhr)`: succeeded, 398KB, no error.
- [x] `seo-extended` category composes correctly with **two** audits now — verified live: category
      scored 1 with the `Product` pass case; separately confirmed via
      `lighthouse-config.test.js`'s regression test that both `structured-data-json-ld` and
      `structured-data-schema-properties` are present in `auditRefs`.
- [x] Migration regression (`structured-data-json-ld` onto the schema-org engine) — re-verified live
      during `/implement` task-07 itself (see that task's commit): pass case, fail case, `extends`
      preservation, all identical to pre-migration behavior.

## Rule-engine specific

- [x] Registry error handling (missing/malformed/schema-invalid ruleset file) — verified via unit
      tests with deliberately broken fixture files, not just the happy path (`registry.test.js`).
- [x] Every checked-in production ruleset file validates against its own JSON Schema — verified via
      a dedicated unit test that runs `ajv` against the real files in `rules/`, not just the test
      fixtures.
- [x] Isolation: audits/category are `configPath`-opt-in only, same as `structured-data-json-ld` —
      not separately re-verified in this round (already established for the sibling audit in
      `structured-data-validation`'s QA; the mechanism is identical, both audits register through
      the same `lighthouse-config.js`).

## Regression

- [x] Full repo `npm run test:typecheck`/`test:lint` pass, confirmed fresh on the feature branch
      before merge (Gate 3 review). Full `npm run test:unit` has pre-existing, unrelated flaky
      failures (Puppeteer/storybook screenshot tests) — confirmed zero overlap with
      `seo-audits`/`structured-data`/`rule-engine` by direct grep, and confirmed the same failure
      category is flaky on `main` itself (re-ran twice on the identical `main` commit during the
      previous feature's QA, got different failure counts both times).

## Summary

Every functional/integration item that matters is verified live, not just unit-tested. `Article`'s
live re-verification was skipped as redundant with `Product`'s (same code path, simpler shape) —
noted explicitly rather than silently omitted. No gaps considered blocking.
