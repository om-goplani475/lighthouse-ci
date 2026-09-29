# QA checklist: Robots Directives and Canonical HTTPS

- slugs: robots-directives-report, robots-directives-conflict, canonical-https
- merged: d0ce06c (committed directly to phase-1-page-metadata, lightweight pass, same as items
  1b/2/3)
- checked what Lighthouse core already covers before designing (same discipline as every prior
  item this phase): core has **no** meta-robots or `X-Robots-Tag` check at all (confirmed via
  grep across `node_modules/lighthouse/core/audits/`), so items 4's scope is fully additive. Core's
  own `canonical` audit (`node_modules/lighthouse/core/audits/seo/canonical.js`, read in full) is
  far more comprehensive than the phase item implied: it already checks presence, validity,
  absoluteness, multiple-conflicting-canonicals, hreflang mismatches, and the "points to domain
  root" mistake — so item 5 only needed to add the one thing core doesn't check (HTTPS scheme).
- a real design fork came up for item 5: "points to a working page" (not redirected/404/blocked)
  and "A→B→A canonical chains" both require *fetching a URL discovered on the page* — a capability
  this package has never had, with SSRF-prevention obligations
  (`.ai-agents/prompts/security-checklist.md`). Confirmed with the developer via a blocking
  question: build the basic (HTTPS-only, no fetch) version now, record the advanced (SSRF-guarded
  fetch) version as "to do later" in `docs/phases/phase-1-page-metadata.md` rather than build it in
  this pass.

## Architecture note: no new gatherer for items 4/5

Both `robots-directives-*` audits read Lighthouse core's own `MetaElements` artifact plus the main
document's response headers via core's `MainResource` computed artifact — the exact same computed
artifact core's own `canonical` audit already uses. `canonical-https` reads core's own
`LinkElements` artifact. Nothing here needed a new gatherer.

### A testing wrinkle, worth recording

`MainResource` (imported by `src/lib/robots-sources.js`) transitively touches `import.meta.url`
and can't load directly under Jest (same class of issue as `rule-engine/registry.js`). Rather than
shell out to real node for these two audits' tests (the established workaround elsewhere in this
package), the audits were split into a thin `audit()` wrapper (untested directly, verified only via
the live run below) and a pure decision function (`buildReportResult`/`buildConflictResult` in
`src/lib/robots-directives.js`, which has zero Lighthouse-computed-artifact imports and loads
directly). This is a cleaner split than shelling out would have been — the actual branching logic
is unit-tested directly and fast, and only the thin artifact-resolution wiring depends on the live
verification.

## Verified live (real `lhci collect`, 4 test pages — one served through a small custom Python
`http.server` subclass that injects a real `X-Robots-Tag: noindex` header on one page, to prove the
header-reading path actually works, not just the meta-tag path)

- [x] **Plain page, no directives, https canonical**: both robots audits `notApplicable`;
      `canonical-https` score 1.
- [x] **Meta robots with `noindex, nofollow, max-snippet:-1`, http canonical**:
      `robots-directives-report` lists all three with correct plain-English explanations (including
      the `-1` value substituted into the `max-snippet` explanation); `robots-directives-conflict`
      `notApplicable` (only one source present); `canonical-https` correctly flags the http://
      canonical.
- [x] **Meta robots with a typo (`no-index`)**: reported as "Not a recognized robots directive —
      likely a typo" rather than silently dropped — the exact behavior this audit exists to
      provide, confirmed working end to end.
- [x] **The conflict case — meta says `index, follow`, real `X-Robots-Tag: noindex` header from
      the custom server**: `robots-directives-conflict` correctly scored 0 with an accurate
      explanation naming both sources. This is the one thing the mocked unit tests structurally
      could not prove (they inject `metaContent`/`headerValue` directly, bypassing
      `MainResource`/response-header parsing entirely) — confirms the real wiring works, not just
      the decision logic in isolation.

## Verified in unit tests

- `robots-directives.test.js` (9 cases) — pure parsing (`parseDirectives`, `blocksIndexing`):
  case-insensitivity, value-bearing directives, unrecognized tokens, empty input.
- `robots-directives-results.test.js` (9 cases) — `buildReportResult`/`buildConflictResult`
  decision logic directly, no mocking needed since these are pure functions taking
  already-resolved strings.
- `canonical-https.test.js` (6 cases) — https pass, http fail, notApplicable (absent/body-only/
  invalid-href canonical, matching core `canonical.js`'s own `{score: 1, notApplicable: true}`
  convention), multiple-canonicals with only one flagged.

## Integration

- [x] `lighthouse-config.test.js` extended — all twelve audits present, `extends:
      'lighthouse:default'` preserved.

## Regression

- [x] `npm run test:typecheck`, `npm run test:lint` clean.
- [x] Scoped `npx jest packages/seo-audits` — 20 suites, 142/142 passing, zero regressions.

## Summary

`robots-directives-report` and `canonical-https`'s notApplicable case are informational/structural
only (no CI-gating implications by themselves). `robots-directives-conflict` and `canonical-https`'s
failure case are both scored normally — real, unambiguous technical inconsistencies, not editorial
judgment calls. The deferred "points to 200"/canonical-chain checks are recorded in
`docs/phases/phase-1-page-metadata.md`'s "To do later" section, not silently dropped. No gaps
considered blocking for what was built.
