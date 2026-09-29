# QA checklist: Rich-Result Eligibility Report

- slug: structured-data-rich-result-eligibility
- merged: 62d659c (commit range 14fb4b0..62d659c on main)
- verified live: 2026-09-29, via real `lhci collect`/`lhci assert` runs against a local static test
  site — not just unit tests, matching the standard this pipeline holds itself to since
  `structured-data-validation`.

## Functional

- [x] Mixed page (two `Product` blocks + one `WebSite` block) verified live: `score: 1`,
      `scoreDisplayMode: informative`, two rows — `Product` collapsed to `count: 2` (not two
      separate rows), `WebSite` reported as `tracked: 'No'` with the fixed "not a rich-result type"
      message. Confirms both Gate-0 decisions (per-type aggregation, untracked types shown) hold at
      runtime, not just in unit tests.
- [x] No-JSON-LD page verified live: `score: null`, `scoreDisplayMode: notApplicable`, no `details` —
      the one case the feature spec actually calls not-applicable.
- [x] The narrower not-applicable condition (JSON-LD present but all-untracked is *not*
      not-applicable) — verified at the unit-test level in this feature's own fixture tests
      (`structured-data-rich-result-eligibility.test.js`); not separately re-verified live as its own
      page since the mixed-page live run already contains an untracked `WebSite` row alongside
      tracked ones, exercising the same code path.

## Edge cases

- [x] `FAQPage`/`HowTo` (tracked but eligibility-unsupported) — verified at the unit-test level:
      `tracked: 'Yes'` while `message` reads the "not currently documented as supported" wording,
      confirming `tracked` and `supported` are kept as genuinely separate concepts, not conflated.
- [x] Malformed JSON block — verified at the unit-test level: silently skipped, same convention as
      both sibling audits.

## Integration

- [x] `seo-extended` category composition — verified live: on the mixed page, category score is `1`
      (informative-mode audits normalize to `1` for scoring purposes, so they never drag a category
      score down); on the no-JSON-LD page, category score is `0` — **not a bug in this feature**,
      traced to `structured-data-json-ld`'s own pre-existing `{score: 0}` behavior when it finds zero
      JSON-LD blocks at all (already reviewed in `structured-data-validation`'s QA), which is the
      only audit in the category still contributing a real number once the other two go
      `notApplicable`. Worth a note here so a future reader doesn't mistake it for a new regression.
- [x] Report renders — verified by generating a real HTML report via
      `ReportGenerator.generateReportHtml(lhr)`: succeeded, 207KB, no error.
- [x] `lighthouse-config.test.js` — extended regression test confirms all three audits present in
      `auditRefs` and the config's `audits` array, `extends` preserved.

## Assertion behavior — the one finding worth reading closely

- [x] **A design-time claim in the audit spec and contract was wrong, and got corrected here, live**
      — not a hypothetical caught by review, an actual empirical contradiction. The design docs
      claimed `['error', {}]` (no explicit `minScore`) would make this audit *always fail*, reasoning
      from `packages/utils/src/assertions.js`'s `minScore` value-getter in isolation (which does map
      `scoreDisplayMode: 'informative'` to a hardcoded `0`). Running a real `lhci assert` against a
      real collected result showed the opposite: it **always passes**. Root cause, traced in
      `node_modules/lighthouse/core/audits/audit.js`'s `_normalizeAuditScore`: Lighthouse core
      normalizes an `informative`-mode audit's LHR `score` to `1` *before* `lhci assert` ever reads
      it, so the assertions.js branch that returns `0` for `informative` mode is unreachable — it
      only exists for a hypothetical `score: null` + `informative` combination that real Lighthouse
      never produces.
- [x] Verified both ways live: `['error', {}]` against the mixed-page result → passes. `['error',
      {}]` against the no-JSON-LD (`notApplicable`) result → also passes (same underlying mechanism:
      `notApplicable` mode also normalizes to a value the `minScore` getter treats as `1`).
- [x] Corrected in three places, not just noted here: `docs/audit-specs/...md` and
      `docs/feature-contracts/...md` got a dated correction notice (design-time reasoning left intact
      as the historical record, not silently rewritten); `packages/seo-audits/README.md`'s consumer
      guidance was rewritten to state the actual, verified behavior — asserting this audit is a safe
      no-op, not a hazard to avoid.

## Regression

- [x] Full repo `npm run test:typecheck`/`test:lint` pass, confirmed fresh on the feature branch
      before merge (Gate 3 review). Scoped `npx jest packages/seo-audits` — 8 suites, 50/50 passing
      (42 existing + 8 new, zero regressions in the two sibling audits).
      Full-repo `npm run test:unit` not re-run in full for this feature — the branch's diff-scope
      check (zero diff against `main` outside `packages/seo-audits`/`docs`/`.ai-agents`) already
      rules out any interaction with the pre-existing flaky suites (Puppeteer/storybook snapshots,
      the `wizard.test.js` deprecation-warning assertion) documented in the last two features' QA.

## Summary

Every functional/integration claim that matters is verified live. The one real finding this QA pass
produced was a correction of this feature's own design-time reasoning about assertion behavior —
worth calling out explicitly as a good example of why this pipeline insists on live verification
rather than trusting static code analysis alone: reading `assertions.js` in isolation produced a
plausible-sounding but wrong conclusion, and only running the actual `lhci assert` command against a
real result caught it before it shipped as incorrect guidance to consumers. No gaps considered
blocking.
