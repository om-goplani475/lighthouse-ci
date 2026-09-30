# Feature: Sitemap vs Indexability

- slug: sitemap-indexability
- requested: 2026-09-30
- type: new-audit

## Summary

A new audit, `sitemap-indexability`, that flags listed sitemap URLs whose own pages say "do not index
me" or "index a different URL instead": **noindex** (an `X-Robots-Tag` header or a `<meta name=robots>`
tag) and **a canonical pointing elsewhere**. A sitemap asks search engines to index its URLs, so
either one is a contradiction (Search Console reports the first as "Submitted URL marked 'noindex'").

To do that it needs each sampled page's response headers and the head of its HTML, which
`sitemap-url-status` (Phase 4 item 5, already merged) currently requests as status-only. Decided with
the developer (2026-09-30): rather than a second set of requests, **one new shared gatherer requests
each sampled URL once** and both audits read it; `sitemap-url-status` is **refactored** to read that
artifact, keeping its results and bounds exactly.

Decisions made with the developer (blocking questions, Phase 4 planning and this intake):

1. **Architecture**: one shared gatherer; `sitemap-url-status` refactored onto it; no extra requests
   to the audited site.
2. **Conflicts flagged**: noindex, and canonical pointing elsewhere. Blocked-by-robots.txt is not
   repeated here (it is `sitemap-robots-crossref`, item 8).
3. **noindex scope**: generic *and* Googlebot/Bingbot-scoped: `<meta name="robots">`, plus
   `<meta name="googlebot">` / `<meta name="bingbot">` and `X-Robots-Tag` values scoped to those
   crawlers (`X-Robots-Tag: googlebot: noindex`). The existing `parseDirectives` does not handle a
   user-agent prefix (`googlebot: noindex` parses as key `googlebot`, so it would not count as
   blocking), so this needs a small **additive** function; the existing `robots-directives-*` audits
   must not change behavior.
4. **Canonical scoring**: fails, **except** a difference that is only a trailing slash, which is shown
   as a note and never fails. noindex fails too.

Constraints carried from earlier Phase 4 work: the sample is evenly spread and deterministic; only
URLs on the same origin as their sitemap are requested; only 2xx pages are judged (non-2xx is
`sitemap-url-status`'s finding); every request goes through `src/lib/safe-fetch.js` (SSRF-protected,
no redirects followed; `LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies); at most 5 requests at a time, 5 s
each, 30 s total, one retry for a network error only; `LHCI_SEO_SITEMAP_SAMPLE_SIZE` (default 10,
1-25) still sets the sample size.

## Concrete pass/fail example

- **Pass**: all 10 sampled URLs return 200 HTML, none is noindex, and each declares no canonical or a
  canonical equal to itself.
- **Fail (noindex)**: a listed `/checkout/thanks` returns 200 with `<meta name="robots"
  content="noindex, follow">`, or with `X-Robots-Tag: noindex`, or with `<meta name="googlebot"
  content="noindex">`, or `X-Robots-Tag: googlebot: noindex`.
- **Fail (canonical)**: a listed `/shoes?color=red` returns 200 with `<link rel="canonical"
  href="https://example.com/shoes">`: the sitemap should list `/shoes`.
- **Note only**: a listed `/shoes` whose canonical is `/shoes/` (trailing slash only).
- **Not judged**: a listed URL that returns 404, redirects, or is not HTML (a PDF): that is
  `sitemap-url-status`'s finding or out of scope; the audit must not double-report it.
- **Not applicable**: no sitemap URL list could be checked (same conditions as `sitemap-url-status`).
- **Regression pass**: `sitemap-url-status` gives the same result as before on the same inputs. The
  known live reference is `https://nodejs.org/en`: 10 of ~1,731 URLs sampled, 5 return 404, score 0.

## Gatherer needs

- New gatherer required: **yes**, `SitemapUrlSample` (name is Agent 01's to settle). It depends on
  `SitemapDocuments` for the URL list, and Lighthouse gatherer dependencies only work through a
  `meta.symbol` (see `docs/audit-specs/sitemap-fetch-and-parse.md`, which found `RobotsTxt` cannot be
  a dependency for that reason), so how it obtains the sitemap URLs (re-run discovery, or share a
  module-level cache, or move the sample into `SitemapDocuments` itself) is a design question.
- What it needs to collect, per sampled URL: final HTTP status, a redirect's `Location`, an error
  message, the `X-Robots-Tag` header value(s), the `Content-Type`, and the first ~64 KiB of the body
  for HTML responses only (enough for `<head>`), reduced to the extracted signals rather than stored
  as raw HTML: the `<meta name=robots|googlebot|bingbot>` content values and the `<link
  rel=canonical>` href(s). This is a **new capability**: `safe-fetch.js` has no export that returns
  headers and reads a bounded prefix of a body (`safeFetchStatus` returns status and `Location` only;
  `safeFetchBytes` reads the whole body up to a cap and does not return the request's headers).

## Scope

- Package(s) affected: `packages/seo-audits` only. Modifies **existing merged code**:
  `sitemap-url-status` (audit refactor), `safe-fetch.js` (new export, additive),
  `robots-directives.js` (new additive function). No `packages/utils` / `packages/cli` changes.
- Out of scope (explicitly):
  - **Blocked by robots.txt**: `sitemap-robots-crossref` (item 8).
  - **Non-2xx and redirecting URLs**: `sitemap-url-status` (item 5); this audit only judges pages
    that returned 2xx.
  - **Non-HTML responses** (PDF, images, XML): skipped, not judged.
  - **JavaScript-rendered signals**: only the raw HTML head is read, so a `noindex` or canonical
    injected by client-side JavaScript is not seen (stated in the audit's own description). Lighthouse
    itself renders the *audited page*, but the sampled sitemap URLs are plain requests, not browser
    loads.
  - **The `X-Robots-Tag` `unavailable_after` date**, and every non-blocking directive; only the
    index-blocking directives (already defined in `robots-directives.js`) count.
  - **Canonical chains and whether the canonical target itself is indexable** (would need further
    requests).
  - **HTTP `Link: <...>; rel="canonical"` headers**: not read in v1 (rare); noted, not built.
  - Any change to what `sitemap-url-status` reports, the sample selection, the bounds, or the
    environment variable.

## Open questions (for Agent 01 and Agent 02, per `.ai-agents/prompts/blocking-questions.md`, ask the
developer directly if any has more than one reasonable answer with real build consequences)

- **How the new gatherer gets the sitemap URL list** (see Gatherer needs): dependency mechanics are
  the constraint. One option worth weighing is folding the sample into the existing `SitemapDocuments`
  gatherer, which already holds the documents and is the natural owner of "requests to sitemap URLs".
- **HTML head extraction without a full parser dependency**: `saxes` is strict XML and will reject
  real-world HTML, and adding an HTML parser is a dependency decision. A bounded, tag-level scan of
  the first 64 KiB is the likely answer, but the correctness risks are real (comments, `<script>`
  content containing the text `<meta`, attribute quoting, `<noscript>`, tags split across the read
  boundary, `<meta name=robots>` in the body) and need explicit handling and tests.
- **Bounded prefix read in `safe-fetch.js`**: how the new export stops reading (destroy the request
  after N bytes without treating it as an error), whether it returns headers as a plain object with
  lowercase names, how it handles multiple `X-Robots-Tag` headers and a compressed response
  (`Content-Encoding`: Node does not decompress for us, and the prefix of a gzip stream is not
  HTML, so the request should send `Accept-Encoding: identity`, and a server that ignores it needs a
  defined outcome).
- **Response size and time for the refactor**: reading up to 64 KiB of every sampled page (up to 25)
  is more bytes than the status-only check; the bound and the effect on the 30 s budget are worth
  stating.
- **Artifact shape** so `sitemap-url-status` can reproduce its current result exactly (including the
  "not checked: time budget" rows and the retry behavior) and the new audit gets what it needs.
- **User-agent-scoped directive parsing**: exact grammar (`X-Robots-Tag: googlebot: noindex`,
  `X-Robots-Tag: bingbot: none, googlebot: noarchive`, `noindex` with no scope in the same header,
  multiple headers), what counts as a match for "Googlebot or Bingbot", and confirming `none` implies
  `noindex, nofollow`.
- **Canonical comparison rules**: resolving a relative canonical against the page URL; ignoring a
  fragment; treating scheme/host case; how a query-string difference, an `http` vs `https` difference
  or a `www` difference is classified (all "elsewhere", failing) vs the trailing-slash-only note;
  what to do with multiple canonical tags that disagree (core's `canonical` audit already flags that
  on the audited page, so probably a single note here).
- **Regression protection** for the refactor: a test that runs `sitemap-url-status`'s existing test
  suite unchanged against the new artifact, plus a live before/after comparison on nodejs.org.
- **Fixture testing**: tests use mock HTML fixtures and injected fetchers, never live URLs (repo
  convention); the bounded-read and head-extraction logic need adversarial fixtures.
