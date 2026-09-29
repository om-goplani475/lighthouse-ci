# QA checklist: Title and Meta Description Pixel-Width Truncation

- slug: pixel-width-truncation
- merged: 5fea5d1 (commit range 1729f7c..5fea5d1 on phase-1-page-metadata — merged locally by the
  developer, no PR/CI gate for this feature; see `.ai-agents/state/current-feature.md`)
- verified live: 2026-09-29, via real `lhci collect`/`lhci assert` runs against five local static
  test pages served over HTTP (not just unit tests, matching the standard this pipeline holds
  itself to since `structured-data-validation`) — a genuinely important check here specifically,
  since this feature's entire premise (real canvas pixel measurement) can only be proven against a
  real browser context, not mocked.

## Functional

- [x] **Pass page** (short title, short description) verified live: `score: 1`,
      `scoreDisplayMode: informative`, zero rows. Confirms the audit doesn't false-positive on
      ordinary content.
- [x] **Title over budget** verified live: an 87-character all-"W" title measured
      `widthPx: 1585.66` against the mobile budget (`maxWidthPx: 580` — Lighthouse's default
      navigation run emulates mobile), correctly flagged as one row.
- [x] **Description over budget** verified live: an all-"W" description measured
      `widthPx: 2061.36` against `maxWidthPx: 680` (mobile), correctly flagged as one row, title
      unaffected.
- [x] **Not-applicable case** verified live: a page with an empty `<title></title>` and no meta
      description tag at all produced `score: null`, `scoreDisplayMode: notApplicable`, no
      `details` — confirms `null`-title (not just missing-title-element) is treated the same as
      absent, and that both fields being absent (not just one) is what triggers `notApplicable`.

## Edge cases

- [x] **Fallback-font regression check — the risk explicitly flagged in the audit spec for live
      sanity-checking, done here** (docs/audit-specs/pixel-width-truncation.md's "Canvas font
      availability in headless Chrome" risk item): an 87-character all-"i" title (same length as
      the all-"W" title above) measured well under the 580px mobile budget (no row emitted at all),
      in sharp contrast to the identical-length all-"W" title's `1585.66px`. This is real,
      meaningfully different pixel output for two strings of equal character *count* but very
      different character *width* — direct live evidence the configured font (`400 20px Arial,
      sans-serif`) is actually being applied inside headless Chrome's canvas, not silently falling
      back to a generic/monospace font that would have produced near-identical widths for both
      strings.
- [x] Title-absent-but-description-present and description-absent-but-title-present — both covered
      by the fixture unit tests (`test/audits/pixel-width-truncation.test.js`); the live
      "title over budget" and "description over budget" pages above each independently exercise one
      field absent/present too (title-over.html's description is short/under budget and produced no
      row for it; desc-over.html's title likewise).
- [x] Desktop-vs-mobile budget selection — verified at the unit-test level
      (`test/audits/pixel-width-truncation.test.js`, the borderline-590px-title case); not
      separately re-verified live as a second full page since `lhci collect`'s default emulation is
      mobile and the live runs above already confirm the mobile budget values are the ones actually
      read from the resolved ruleset at runtime (`580`/`680`, matching
      `rules/serp-pixel-budgets/2026-10.json` exactly) — the desktop branch is the same code path
      with a different object key, not independent logic that needs its own live pass.

## Integration

- [x] `seo-extended` category composition — verified live: score `0` on every test page here. **Not
      a regression from this feature** — same pre-existing, already-documented cause as
      `structured-data-rich-result-eligibility`'s QA: `structured-data-json-ld` contributes a real
      `{score: 0}` whenever a page has zero JSON-LD blocks (all five test fixtures here have none),
      and it's the only audit in the category still contributing a non-normalized number once the
      informative-mode audits (`pixel-width-truncation` included) normalize to `1`.
- [x] Report renders — verified by generating a real HTML report via
      `ReportGenerator.generateReportHtml(lhr)` for the title-over-budget result: succeeded, 404KB,
      contains the `pixel-width-truncation` audit id.
- [x] `lighthouse-config.test.js` — extended regression test confirms `PixelWidth`/
      `pixel-width-truncation` present in `artifacts`/`audits`/`seo-extended.auditRefs` alongside
      all four pre-existing entries, `extends` preserved.
- [x] `lhci assert` with `'pixel-width-truncation': ['error', {minScore: 1}]` — verified live against
      all five collected results, including the two with flagged rows (title-over.html,
      desc-over.html): **all five pass**, exit code `0`. Confirms the documented
      informative-mode-always-passes behavior for this audit specifically, not just inherited by
      analogy from `structured-data-rich-result-eligibility`'s earlier verification of the same
      Lighthouse-core mechanism.

## Regression

- [x] Scoped `npx jest packages/seo-audits` — 12 suites, 86/86 passing (74 existing + 12 new
      across the gatherer, audit, and registry test files, zero regressions in any sibling
      audit/engine).
- [x] `npm run test:typecheck` and `npm run test:lint` — both clean, run after every task during
      implementation, not just once at the end.
- [x] Full-repo `npm run test:unit` was run once during implementation; its only failures are 101
      pre-existing `packages/server` Storybook/Puppeteer image-snapshot failures
      (`ProtocolError: Emulation.setDeviceMetricsOverride` — a Puppeteer/Chrome protocol-version
      mismatch in this environment), unrelated to this feature — confirmed by diff scope: this
      feature's entire merged diff touches only `packages/seo-audits` and `docs`/`.ai-agents`, never
      `packages/server`.

## Summary

Every functional/edge-case/integration claim that matters was verified against real `lhci
collect`/`lhci assert` runs, not just mocked unit tests — appropriate given this feature's core
technical risk (does canvas pixel measurement actually reflect meaningfully different font
rendering inside headless Chrome, not a generic fallback) is exactly the kind of thing static
analysis and mocks can't settle. The fallback-font sanity check flagged as an open risk in the audit
spec was resolved here, live, with a real measured-width contrast (`1585.66px` vs. well under
`580px` for equal-length strings of very different character composition) — not deferred or waved
through. No gaps considered blocking.
