# QA: Social/Sharing Metadata (Phase 3, items 1-4)

Covers the four items built lightweight-mode: `open-graph-completeness`,
`open-graph-canonical-match`, `open-graph-image-reachable`, `twitter-card-completeness`. Item 5
(social preview renderer) is separately scoped, not covered here.

## Sourcing

Open Graph's required-vs-recommended split is taken directly from the protocol spec fetched live
from `ogp.me`: `og:title`/`og:type`/`og:image`/`og:url` are required; `og:description`/
`og:site_name`/`og:image:alt` are recommended. The spec explicitly states no minimum/recommended
`og:image` pixel dimensions — so `open-graph-completeness` deliberately does not check dimensions
or aspect ratio against an invented threshold (see `docs/phases/phase-3-social-metadata.md`'s "To
do later").

Twitter/X Card's official docs are largely paywalled/degraded and could not be directly fetched
the way schema.org's were for `structured-data-deprecated-properties`. What's checked
(`twitter:card` required; `twitter:title`/`twitter:description`/`twitter:image` fall back to
`og:*` when absent) is corroborated across multiple secondary sources, stated as a caveat directly
in the audit's own module doc and the phase tracker, not buried.

## What was built

- `open-graph-completeness.js` — no new gatherer; reads Lighthouse core's own `MetaElements`
  artifact (`property` field, same artifact `robots-directives-report` already reads via `name`).
- `open-graph-canonical-match.js` — reads `MetaElements` + core's `LinkElements`.
- `open-graph-image-reachable.js` — reads `MetaElements`, fetches via a new `safeFetchStatus`
  export added to `src/lib/safe-fetch.js`.
- `twitter-card-completeness.js` — reads `MetaElements`, with `og:*` fallback resolution.
- `lighthouse-config.js`: all four registered, `seo-extended` category updated (twenty audits
  total now).
- Tests: all four audits load directly in Jest (only import `lighthouse/core/audits/audit.js`, no
  `import.meta.url` — same as `document-title-quality`), no shell-out workaround needed. 34 new
  test cases across the four audit files plus `safe-fetch.js` extensions.

## A real bug found and fixed during this QA pass (not a new-feature edge case)

While live-testing `open-graph-image-reachable` against a real external `og:image` URL (not just
localhost), `safeFetchStatus` crashed with `TypeError: Invalid IP address: undefined` instead of
returning a status code.

Root cause: `safeLookup` (the `dns.lookup`-compatible function `safe-fetch.js` passes as Node's
`lookup` request option) always replied with a single `(address, family)` tuple. Node's own
`net.connect` requests `{all: true}` and expects an **array** back whenever Happy Eyeballs is
active — confirmed via `net.getDefaultAutoSelectFamily()` returning `true` on the Node version this
runs on (the default since Node 20), which is the normal path for any real `http.request`/
`https.request` to a hostname, not an edge case. The shape mismatch made Node's own connect logic
throw before a request was ever sent.

This is a **pre-existing bug**, not something introduced by this feature — `manifest-icons` uses
the exact same `safeLookup`/`safeFetchJson` path and would hit the identical crash fetching any
real manifest on any real domain. It went uncaught until now because every existing test either
used a literal IP (which skips this path entirely) or a real local test server reached via a
permissive test-only lookup (which bypasses `safeLookup` by design) — nothing had exercised
`safeLookup` against a real, non-literal hostname through Node's actual connect logic before.

Fix: `safeLookup` now honors `options.all` and replies in the shape actually requested (single
tuple or array), exactly like real `dns.lookup` does, while preserving the existing fail-closed
policy (any private/reserved candidate address rejects the whole lookup, in either mode).

- [x] Before the fix: `safeFetchStatus('https://www.google.com/favicon.ico')` threw `Invalid IP
      address: undefined`.
- [x] After the fix: resolves `{status: 200}`.
- [x] `safeFetchJson` against a real external URL (previously would have hit the same crash):
      confirmed it now reaches a real HTTP response (`404`) instead of crashing.
- [x] SSRF protection still intact in both modes: a literal private/reserved IP (`127.0.0.1`,
      `169.254.169.254`) is still rejected with `options.all` set.

New regression tests added to `test/lib/safe-fetch.test.js` covering `options.all` for both the
literal-IP-accept and literal-IP-reject paths (a real hostname's `options.all` path is intentionally
covered live, not with a unit test hitting real DNS — see below and this repo's "no live URLs in
unit tests" convention).

## Verified live (real `lhci collect`)

Two local fixtures (`full.html`, `broken.html`), `og:image`/`twitter:image` pointed at real
external URLs specifically so the reachability check exercises the real (post-fix) code path, not
just a mocked one:

**`full.html`** — complete, consistent Open Graph + Twitter Card markup, `og:image` pointing at
`https://www.google.com/favicon.ico` (a real, always-200 URL), `og:url` matching the canonical:

- [x] `open-graph-completeness`: `score: 1`, zero rows.
- [x] `open-graph-canonical-match`: `score: 1`.
- [x] `open-graph-image-reachable`: `score: 1` (confirms the fix — this scored `0` with a crash
      message before it).
- [x] `twitter-card-completeness`: `score: 1`, zero rows.

**`broken.html`** — deliberately defective: `og:description`/`og:site_name`/`og:image:alt`
omitted, `og:url` pointing at a different path than the canonical, `og:image` pointing at a real
URL confirmed to 404 (`https://www.google.com/this-does-not-exist-xyz-404-test`), no `twitter:*`
tags at all:

- [x] `open-graph-completeness`: `score: 1` (all four *required* tags present) with three
      `info`-severity rows for the missing recommended ones — confirms recommended-only gaps
      never fail the audit.
- [x] `open-graph-canonical-match`: `score: 0`, `explanation` names both URLs.
- [x] `open-graph-image-reachable`: `score: 0`, `explanation` correctly reports "returned HTTP
      404" (not a generic failure).
- [x] `twitter-card-completeness`: `score: 0`, `explanation` names the missing `twitter:card` tag
      specifically (fails fast, no misleading per-field rows when the card type itself is absent).

## Full suite

`npm run test:typecheck` and `npm run test:lint` both clean. `npx jest packages/seo-audits`: 33
suites, 268 tests, all passing.
