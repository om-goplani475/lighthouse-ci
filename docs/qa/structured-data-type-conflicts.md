# QA checklist: Duplicate and Conflicting `@type` Detection

- slug: structured-data-type-conflicts
- merged: 19cbbc2 (commit range 71e55b5..19cbbc2 on main — includes the post-merge prototype-safety
  fix, applied on its own branch and ff-merged before this QA pass, per the "merged ≠ done, fix real
  findings promptly" standard)
- verified live: 2026-09-29, via real `lhci collect`/`lhci assert` runs against a local static test
  site — not just unit tests.

## Functional

- [x] Clean page (single `Organization`, no conflicts) verified live: score 1, no findings.
- [x] Duplicate `Organization` (two blocks) verified live: score 0, exactly one `duplicate-count`
      finding naming the type and count.
- [x] `Product` conflict (two blocks sharing `sku`, differing nested `offers`) verified live: score
      **1** (conflicting-entity never affects score, confirmed at the LHR level, not just by
      reading the code) — one `conflicting-entity` finding naming `offers` as the differing
      top-level key, both differing values shown in the message. Confirms the "top-level comparison
      only, no recursion" design decision live: the finding names `offers` as a whole, not
      `offers.price` specifically, exactly as designed.
- [x] Listing page (two `Product` blocks, different `sku`, both named similarly) verified live:
      score 1, zero findings — the core false-positive-risk case this feature exists to get right,
      confirmed live, not just in unit/fixture tests.
- [x] Not-applicable case (page with only `Review` markup — tracked by neither `singularTypes` nor
      `identityFields`) verified live: `score: null`, `scoreDisplayMode: notApplicable`.

## Integration

- [x] `lhci assert` enforces `duplicate-count` meaningfully — verified live, and specifically
      contrasted with the previous feature's finding: set
      `'structured-data-type-conflicts': ['error', {}]` and ran against all 4 collected pages. Only
      the duplicate-`Organization` page failed (`expected: >=0.9, found: 0`, exit status 1) — the
      other 3 (including the real-conflict page) passed. This is the opposite of
      `structured-data-rich-result-eligibility`'s always-passes behavior, and confirms this audit's
      contract note ("this audit does have a real scored component, unlike the informative one") is
      correct — checked, not assumed, per the lesson from that prior feature.
- [x] Report renders — verified by generating a real HTML report via
      `ReportGenerator.generateReportHtml(lhr)`: succeeded, 208KB, no error.
- [x] `seo-extended` category composes correctly with all four audits present — verified live across
      all 4 collected pages, category score varies sensibly page-to-page (e.g. 0.33 on the
      duplicate-org page, reflecting the real failure; 0.67 elsewhere, reflecting the other 3
      audits' own independent scoring of the same minimal test markup — not specific to this
      feature).
- [x] `lighthouse-config.test.js` — extended regression test confirms all four structured-data
      audits present, `extends` preserved.

## Security — a real finding, fixed before this QA pass, not just noted

- [x] **`@type: "__proto__"` regression** — during `/security-review`, found that
      `typeCounts`/`blocksByType` were built as plain `{}` objects keyed directly by the page's own
      `@type` value. A block declaring `"@type": "__proto__"` would silently reassign that specific
      object's own prototype via the inherited setter (confirmed via a direct Node test: does not
      pollute the global `Object.prototype`, effect is contained to the one local object, but still
      unintended). **Fixed in the same sitting** (`Object.create(null)` for both objects, on its own
      branch, ff-merged into `main` before this QA pass) rather than deferred to backlog. Verified
      live post-fix: a page with `"@type": "__proto__"` now audits cleanly (score 1, no findings —
      simply an untracked type, same as any other unrecognized one). Regression test added
      (`structured-data-type-conflicts.test.js`) asserting this exact case.
- [x] See `.ai-agents/state/security-findings.md` for the full write-up, including one accepted
      (not fixed) low-risk item: `conflicting-entity` messages embed unbounded field values from
      page content, unlike `structured-data-json-ld`'s length-capped snippet — assessed as low risk
      under the same "public, crawler-facing markup" reasoning already accepted for that snippet,
      recorded for a possible future length cap, not blocking.

## Regression

- [x] Full repo `npm run test:typecheck`/`test:lint` pass, confirmed fresh after the security fix.
      Scoped `npx jest packages/seo-audits` — 10 suites, 70/70 passing (69 from this feature's
      implementation + 1 new regression test from the security fix). The higher-risk `registry.js`
      change (task-03) was specifically re-verified against the full `seo-audits` suite during
      `/implement`, not just its own new test file — confirmed zero regression in the three
      previously-shipped audits.
- [x] Diff-scope check: this feature (including the security fix) touches only
      `packages/seo-audits`, `docs/`, and `.ai-agents/state` — no other package affected, ruling out
      interaction with the pre-existing flaky suites documented in every prior feature's QA
      (Puppeteer/storybook snapshots, the `wizard.test.js` deprecation-warning assertion).

## Summary

Every functional/integration claim verified live, including the one this feature specifically needed
proof for (that `conflicting-entity` truly never affects score, and that `duplicate-count` truly
does — the opposite pairing from the previous feature, checked independently rather than assumed to
follow the same pattern). One real security finding was caught during review and fixed the same
sitting, with its own regression test, not deferred. No gaps considered blocking.
