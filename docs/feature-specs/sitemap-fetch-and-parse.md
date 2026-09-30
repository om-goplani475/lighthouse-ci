# Feature: Sitemap Fetch and Parse

- slug: sitemap-fetch-and-parse
- requested: 2026-09-30
- type: new-audit

## Summary

A new gatherer that discovers, fetches and parses the page's XML sitemap(s) **once** per run, plus
three thin audits that read its artifact: `sitemap-valid` (Phase 4 item 4), `sitemap-duplicate-urls`
(item 6) and `sitemap-limits` (item 7). Every later sitemap item (URL-status sample, sitemap ↔
robots.txt ↔ indexability cross-checks) reuses the same artifact instead of re-fetching, which is
the reason for building a gatherer rather than three audits that each fetch on their own
(`manifest-icons`' pattern would mean three-plus fetches and parses of one possibly multi-MB file).

This is the first gatherer in this package that makes outbound requests, and the first to fetch a
URL taken from an origin-controlled file (robots.txt's `Sitemap:` lines, which may point anywhere).
That makes it the highest-risk surface in Phase 4, which is why the gatherer gets the full pipeline
while the audits on top may follow lightweight mode.

Decisions made with the developer (2026-09-30, blocking questions, Phase 4 planning conversation):

1. **Discovery**: use `Sitemap:` lines from robots.txt (Lighthouse core's `RobotsTxt` artifact);
   when none are declared, fall back to probing `/sitemap.xml` on the page's origin. The developer
   chose the fallback over the recommended declared-only option, accepting the one speculative
   request to get coverage of sites relying on the default location.
2. **Parser**: `saxes` (strict, gives line/column errors for the "well-formed" check), already in
   `node_modules` via `jsdom`; declare it in `packages/seo-audits/package.json`.
3. **Architecture**: one shared gatherer, three thin audits. Gzip (`.xml.gz`) supported; response
   size capped; a sitemap index is followed one level with a cap on child sitemaps.

## Concrete pass/fail example

- **Pass** (`sitemap-valid`): robots.txt declares `https://example.com/sitemap.xml`, which returns
  200 with well-formed XML, a `<urlset>` root in the sitemaps.org namespace, and each `<url>` has an
  absolute http(s) `<loc>`.
- **Fail** (`sitemap-valid`): the same file with an unclosed tag (reported with line/column), or a
  `<urlset>` with no namespace, or a `<loc>` that is relative or a non-http scheme, or a declared
  sitemap URL that returns 404.
- **Pass** (`sitemap-duplicate-urls`): every `<loc>` in the sitemap is distinct.
  **Fail**: the same URL listed twice (compared after trivial normalization decided in design —
  e.g. exact string vs. fragment/trailing-slash/case), with the duplicates listed.
- **Pass** (`sitemap-limits`): a sitemap with 30,000 URLs, under 50 MB uncompressed.
  **Fail**: a sitemap with 60,000 `<url>` entries (over the 50,000 protocol limit) or over 50 MB
  uncompressed. A sitemap index whose child sitemaps are each within limits passes.
- **Not applicable** (all three): no sitemap could be discovered (nothing declared and
  `/sitemap.xml` returned 404) — a missing sitemap is item 1's concern and `robots-txt-sitemap-
  declared` already flags the missing declaration — or robots.txt/the fetch was unavailable
  (network failure/5xx), where nothing can be concluded.

## Gatherer needs

- New gatherer required: **yes** — the first with outbound network access, and the first to be
  built on top of another artifact (`RobotsTxt`) rather than reading the page directly. The
  established gatherer pattern is `src/gatherers/*.js`; whether this uses Lighthouse's
  `meta.dependencies` to receive `RobotsTxt` or re-reads robots.txt itself is a design decision
  for Agent 01 (see Open questions).
- What it needs to collect, per discovered sitemap (and, for an index, per child up to the cap):
  the final fetch outcome (HTTP status or fetch error), whether it was gzip-encoded, byte sizes
  (compressed and uncompressed), the document kind (`urlset`, `sitemapindex` or invalid), XML
  parse errors with line/column, the list of `<loc>` values with any per-entry problems, and the
  entry count. All fetching goes through `src/lib/safe-fetch.js`, which will need a new bounded
  text/binary fetch export alongside `safeFetchJson`/`safeFetchStatus`, with the same SSRF
  protections (scheme allowlist, post-DNS private-IP blocking, DNS-rebinding-resistant lookup, no
  redirects followed) plus a bounded decompression size (gzip-bomb protection).

## Scope

- Package(s) affected: `packages/seo-audits` (new gatherer, `safe-fetch.js` extension, three audits,
  `lighthouse-config.js`, `package.json` for `saxes`). No `packages/utils`/`packages/cli` changes.
- Out of scope (explicitly):
  - **URL-status sample** (Phase 4 item 5) — reuses this artifact but is its own feature; it is the
    one that makes requests to the *listed* URLs, with its own sampling bounds.
  - **Cross-checks** — sitemap ↔ robots.txt ↔ crawlability, sitemap vs indexability (items 8-9),
    which each get their own design conversation first.
  - **`llms.txt`** (item 10).
  - Sitemap extensions in depth — `<image:image>`, `<video:video>`, `<news:news>`, `hreflang`
    `xhtml:link` entries are tolerated (not reported as invalid) but not validated; validating them
    is a separate, later feature.
  - Text/RSS/Atom sitemap formats — only XML sitemaps (`urlset`/`sitemapindex`) and their gzip form.
  - Following a sitemap index more than one level deep, or fetching more than the child cap;
    reaching the cap must be reported as truncation, not silently as a pass.
  - Following HTTP redirects (see the safe-fetch policy); a sitemap that only redirects is reported
    as such, not followed.
  - Whether the sitemap's URLs are reachable, indexable, canonical or on the same host as the
    sitemap — none of that is checked here.

## Open questions (for Agent 01 — per `.ai-agents/prompts/blocking-questions.md`, ask the developer
directly if any has more than one reasonable answer with real build consequences)

- **How does the gatherer get robots.txt?** Via `meta.dependencies` on core's `RobotsTxt` artifact
  (no second fetch; needs confirming that dependencies work for a fork gatherer in navigation mode
  on Lighthouse 12.6.1), or by fetching `/robots.txt` itself through `safe-fetch.js`. Note core's
  own fetch goes through the browser, not the SSRF-protected Node path.
- **Cross-origin `Sitemap:` URLs**: the sitemaps protocol allows a robots.txt to point at another
  host. Fetch it (through safe-fetch), or only fetch same-origin/same-site sitemaps? This is a real
  security-versus-coverage tradeoff for the security review, not just an implementation detail.
- **Bounds**: the concrete caps (max response bytes compressed and uncompressed, request timeout,
  max child sitemaps followed from an index, max total sitemaps per run) and what a truncated run
  reports. The protocol limits (50,000 URLs, 50 MB uncompressed) are the natural anchors, but the
  fetch-time cap must be higher than 50 MB for `sitemap-limits` to be able to *detect* an
  over-limit file, or the audit has to report "at least this large".
- **Artifact shape and failure modeling**: how a fetch error, a non-200 status, a decompression
  failure and an XML parse error are distinguished in the artifact so each audit can decide
  pass/fail/not-applicable without re-deriving them; and whether the URL list is stored in full in
  the artifact (memory and LHR size for 50,000 entries) or capped.
- **Duplicate normalization** for `sitemap-duplicate-urls`: exact-string match only, or also
  trivial equivalences (trailing slash, host case, fragment, default port)? Trailing-slash and case
  equivalence are not universally true in URLs, so the conservative default is exact-string, with
  a note.
- **Scoring/gating**: `sitemap-valid` fail vs. warning severity of individual problems, and
  whether `sitemap-limits` should fail or only report when a protocol limit is exceeded (Google
  documents these as hard limits it enforces).
- **Fixture testing**: the audits can be tested from fixture artifacts, but the gatherer's fetch
  and parse need either a local test HTTP server (as `safe-fetch.test.js` does) or injected
  fetchers; confirm the approach so tests never hit live URLs, per the repo convention.
