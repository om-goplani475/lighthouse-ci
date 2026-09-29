# QA checklist: Favicon Presence/Quality and Manifest Icons

- slugs: favicon-presence, favicon-quality, manifest-icons
- merged: 91dc05a (committed directly to phase-1-page-metadata, lightweight pass — except for
  `src/lib/safe-fetch.js`, which merited real care rather than lightweight-mode speed given it's
  the first outbound-fetch capability this package has ever had; see
  `.ai-agents/state/security-findings.md`'s dedicated entry)
- checked what Lighthouse core already covers before designing: **nothing** — no favicon/manifest/
  icon audit exists anywhere in core, and this Lighthouse version doesn't even have a
  `WebAppManifest` gatherer/artifact (the PWA-category audits were stripped from this version).
  Confirmed via grep and directory listing, not assumed.
- item 6 had the same basic-vs-advanced fork as item 5 (canonical): fetch-based manifest
  validation needs real SSRF-prevention work. Unlike item 5, the developer chose the advanced
  option here via blocking question (2026-09-29) — build the SSRF-protected fetch now, not defer
  it.

## Architecture

- New `FaviconLinks` gatherer — core's own `LinkElements` collects every `<link>` but omits
  `sizes`/`type`, needed here; narrowly scoped to only `icon`/`shortcut icon`/`apple-touch-icon`
  (-precomposed)/`manifest` rels, not every link on the page.
- Two scored/informational-split audits reusing that one gatherer (`favicon-presence`,
  `favicon-quality`) — no fetch, same "presence vs. quality-suggestion" scoring-model split as
  `document-h1-count`/`h1-title-relevance`.
- `manifest-icons` — the one audit that fetches (the manifest JSON), via `src/lib/safe-fetch.js`.
  Split into pure decision logic (`buildManifestIconsResult`, unit-tested directly) and a thin
  `audit()` wrapper (fetch verified only live, mocked in unit tests) — same pattern established
  for the robots-directives audits.

## Verified live (real `lhci collect`)

- [x] **No favicon at all**: `favicon-presence` score 0 with explanation; `favicon-quality` and
      `manifest-icons` both `notApplicable` (nothing to evaluate).
- [x] **Good favicon coverage** (SVG icon + apple-touch-icon + manifest link): `favicon-presence`
      score 1; `favicon-quality` clean (no rows).
- [x] **Single small `.ico` favicon only, no apple-touch-icon**: `favicon-quality` correctly
      flagged **both** "Single size only" and "No apple-touch-icon" as independent rows.
- [x] **The SSRF protection, against a real fetch attempt, not just in isolation**: a test page's
      manifest link pointed at `http://127.0.0.1:1/should-be-blocked` (a closed local port, chosen
      over the real cloud-metadata IP after that address caused an unrelated ~90s hang at the
      Chrome-navigation level — see the security-findings entry for why). `manifest-icons` scored
      0 with the exact expected refusal reason in its `explanation`, confirming the block fires
      end-to-end through the real audit, not just against the `safeFetchJson` function directly.
- [x] **A genuine, documented verification gap, not glossed over**: the "successful fetch → score
      1" path could **not** be proven via a live `lhci collect` run, because the only server
      available in this sandboxed environment is on `localhost` (`127.0.0.1`) — which
      `safe-fetch.js` correctly refuses to fetch, being a real private/loopback address. Getting a
      live "success" result would require either weakening the real SSRF protection (never
      acceptable) or fetching from the live public internet (not available/appropriate in this
      session). This is covered instead by two separate, real tests: `fetchJsonWithLookup`'s own
      test suite proves the actual HTTP GET/JSON-parse/timeout/size-cap mechanics work against a
      real local server (using a test-only permissive lookup that never weakens the production
      `safeFetchJson` path — see safe-fetch.js's own module doc for why that's structural, not
      just documented), and `buildManifestIconsResult`'s unit tests prove the score-1-vs-0 decision
      logic is correct given a resolved manifest object. Together these constitute genuine
      end-to-end coverage, just split across two mechanisms instead of one live run — recorded
      explicitly here rather than claimed as something a single live pass verified.

## Verified in unit tests

- `favicon.test.js` (14 cases) — pure helpers: link filtering, manifest-link lookup, size parsing,
  scalability detection, manifest icon size (including the real manifest-spec `sizes` string
  shape — caught and fixed a design mistake during development, see below), and
  `buildManifestIconsResult`'s full decision matrix.
- `favicon-links.test.js` (2 cases) — gatherer pass-through, same mocked-evaluate pattern as every
  other gatherer test in this package.
- `favicon-presence.test.js` (5 cases), `favicon-quality.test.js` (6 cases) — scored/informational
  fixture tests.
- `manifest-icons.test.js` (5 cases) — audit control flow with `safeFetchJson` mocked via
  `jest.mock`, confirming it's called with the manifest href and that fetch errors (network,
  SSRF-block, timeout, invalid JSON — all surfaced the same way, as a rejected promise) map to a
  score-0 result with the error message included.
- `safe-fetch.test.js` (16 cases, written before any audit code — see
  `.ai-agents/state/security-findings.md`) — the SSRF/DoS protection itself.

### A design mistake caught by writing the test, not just by review

The first draft of `manifestIconSize` assumed manifest icon entries had separate `width`/`height`
number fields. The real Web App Manifest spec (and every real manifest) uses a `sizes` string in
the exact same `"WxH WxH ..."` format as the favicon `<link sizes>` attribute — there is no
`width`/`height` field at all. Caught while writing `favicon.test.js`'s fixtures (using real
manifest JSON shapes) before this ever reached a live test, fixed to reuse `largestDimension`
rather than inventing a second, wrong parsing path.

## Integration

- [x] `lighthouse-config.test.js` extended — all fifteen audits present, `extends:
      'lighthouse:default'` preserved.

## Regression

- [x] `npm run test:typecheck`, `npm run test:lint` clean.
- [x] Scoped `npx jest packages/seo-audits` — 26 suites, 193/193 passing, zero regressions.

## Summary

This is the most consequential feature built in Phase 1 from a risk standpoint (first outbound
fetch), and it got proportionate care rather than the lightweight-mode default: a dedicated,
security-checklist-driven design pass, a real bug caught by the test suite before it ever shipped
(the literal-IP `lookup`-bypass), and an honestly-documented verification gap rather than a
claimed-but-not-real live success-path test. No gaps considered blocking for what was built; the
one deferred piece (this being the "advanced" option already, there's nothing further deferred
for item 6) is nothing — unlike item 5, this phase item is fully closed, not partially.
