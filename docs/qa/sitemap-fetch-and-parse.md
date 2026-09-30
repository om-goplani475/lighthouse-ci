# QA checklist: Sitemap Fetch and Parse

- slug: sitemap-fetch-and-parse
- merged: 5b76bb7 (into `phase-4-robots-sitemap`, ff-only); security fixes on
  `fix/sitemap-security-review-findings` (see `.ai-agents/state/security-findings.md`)

Covers the `SitemapDocuments` gatherer and the `sitemap-valid`, `sitemap-duplicate-urls` and
`sitemap-limits` audits. Verified with real `lhci collect` runs against public sites (the fetch path
refuses loopback/private addresses by design, so local pages cannot be used), plus the local-server
integration test for failure paths.

## Functional

Real `lhci collect --settings.configPath=<seo-audits config>` runs, 2026-09-30:

- [x] **Declared sitemaps, all pass** — `https://nodejs.org/en`: two `Sitemap:` lines
      (`/sitemap.xml`, 1,651 URLs, 1.6 MiB; `/learn/sitemap.xml`, 88 URLs). `sitemap-valid`,
      `sitemap-duplicate-urls`, `sitemap-limits` all `score: 1`; limits table lists both files.
- [x] **Sitemap index with gzip children; real duplicate found** — `https://developer.mozilla.org/en-US/`:
      declared `/sitemap.xml` is an index of `.xml.gz` children (14,786 URLs / 123.5 KiB gzip / 1.8 MiB
      uncompressed for `en-US`). `sitemap-valid` `score: 1`; `sitemap-duplicate-urls` `score: 0`,
      one row (`https://developer.mozilla.org/en-US/blog/` listed twice in `en-us/sitemap.xml.gz`), a
      genuine duplicate in the live sitemap; `sitemap-limits` `score: 1` with the truncation note
      "Only the first 10 sitemap files were checked; the rest were not."
- [x] **No sitemap discoverable** — `https://example.com/` (no robots.txt, `/sitemap.xml` 404) and
      `https://www.python.org/` (robots.txt with no `Sitemap:` line, `/sitemap.xml` not found): all
      three audits `notApplicable`.
- [ ] Not verifiable live: a *failing* `sitemap-valid` (needs a real public site with a broken
      sitemap) and a *failing* `sitemap-limits` (a >50,000-URL file). Both are covered by the
      fixture-artifact audit tests and, for the fetch/gzip/redirect/timeout/over-cap paths, by
      `test/gatherers/sitemap-documents.integration.test.js` against a real local server.

## Edge cases

- [x] robots.txt absent → falls back to `/sitemap.xml` probe (example.com: `none`; python.org: `none`)
- [x] Gzip sitemap detected and parsed (MDN children); gzip under a plain `.xml` URL, corrupt gzip,
      truncated gzip: unit + integration tests
- [x] Gzip bomb (60 MiB of zeros, <200 KB on the wire): stopped at the 50 MiB + 1 output cap, flagged
      `exceededUncompressedLimit`, not parsed (integration test with the real cap)
- [x] Redirecting sitemap URL: reported with `Location`, never followed, including a redirect to
      `169.254.169.254` (integration test)
- [x] Slow server and a byte-trickling server: both end at the total deadline (integration test)
- [x] Body over the byte cap: rejected without buffering (integration test)
- [x] Index children: 404 child recorded without aborting the rest; nested index not followed; cap of
      10 documents flags truncation; invalid or duplicate child `<loc>` never requested (unit tests)
- [x] Malformed XML: strict-parser error with line and column; truncated document; empty body; plain
      text; wrong root; wrong or missing namespace; DTD entity not expanded (unit tests)
- [x] Extension elements (`image:`, `xhtml:`) tolerated, not reported (unit tests)
- [x] **Hostile deeply-nested XML** (found by the security review): 96 KB of nested tags took 17 s
      before the fix, 1 ms after; a 1 MiB document is now rejected in well under a second
- [x] Audit never throws when the artifact is missing pieces: not-applicable on `none`/`unavailable`,
      on nothing fetched, and on nothing checkable
- [ ] Not exercised live: the `unavailable` discovery branch (robots.txt 5xx / network failure);
      unit and integration tests only

## Integration

- [x] All three audits appear in the `seo-extended` category in every run (weight 1 each);
      `lighthouse-config.test.js` asserts the artifact and the 27 audit ids resolve
- [x] `lhci assert` enforces the suggested severities (real run against the MDN result):
      `'sitemap-duplicate-urls': ['warn', {minScore: 1}]` prints a warning and exits 0;
      `['error', {minScore: 1}]` fails with exit status 1
- [x] No new `.lighthouserc.js` keys (caps are constants); a fresh install works with only `configPath`
- [ ] Not checked: rendering in `packages/viewer`. Nothing in `packages/viewer` changed and the audits
      use the standard `table` details type, but it was not opened in the viewer.

## Regression

- [x] seo-audits suite: 475 tests pass; typecheck and lint clean
- [x] The change set touches nothing outside `packages/seo-audits` apart from docs and pipeline state
- [ ] `npm run test`: 12 suites failed, mostly the Storybook/Puppeteer image tests in
      `packages/server`. Not caused by this diff (no changes there) but **not confirmed** against the
      base branch; open item.
- [ ] `npm run start:seed-database`: not run (needs the server database; unrelated to this diff)

## Observations, not defects

- The first sitemap fetches add real network time to a run: up to 5 s for robots.txt plus 10 s per
  document, at most 10 documents. MDN (10 documents, all small) added no noticeable delay.
- MDN's index has more child sitemaps than the 10-document cap, so a large multi-locale site is
  only sampled; the audit says so instead of passing the rest silently.

## Follow-up: private-network opt-in (`LHCI_SEO_ALLOW_PRIVATE_NETWORK`), 2026-09-30

Added after the developer confirmed the tool runs in CI against both public URLs and localhost or
private staging (where the SSRF policy refused the page's own robots.txt and sitemap, and the audits
silently showed not-applicable).

- [x] Real `lhci collect` against a site on `http://localhost:8841/` (robots.txt with a `Sitemap:`
      line, a sitemap with one duplicated URL):
      - opt-in **off**: all three audits `notApplicable`, and the report carries the run warning
        "Sitemap audits were skipped: http://localhost:8841/robots.txt could not be fetched: refusing
        to connect to "localhost": resolves to a private/reserved address (127.0.0.1). To audit your
        own private or staging host, set LHCI_SEO_ALLOW_PRIVATE_NETWORK=1."
      - opt-in **on** (`=1`): no warning; `sitemap-valid` 1, `sitemap-limits` 1,
        `sitemap-duplicate-urls` 0 ("1 URL(s) are listed more than once")
- [x] What the opt-in can and cannot unblock: 44 tests. Permitted only: loopback, RFC 1918, IPv6 ULA
      and their IPv4-mapped forms. Still blocked with it on: `169.254.169.254`, `169.254.0.0/16`,
      `fe80::/10`, `0.0.0.0`, `100.64.0.0/10`, multicast, `[::ffff:a9fe:a9fe]`, NAT64 and 6to4 wrapping
      the metadata address; the refusal for those does not mention the setting
- [x] Only exactly `1` or `true` opts in (`0`, `false`, `yes`, `on`, empty and ` 1` do not); read on
      every request, so toggling between two calls takes effect immediately
- [x] Real default fetch path (not the test-only lookup) against a local server: literal-IP and
      `localhost` hostname both fetched when opted in, both refused when not
- [x] seo-audits suite: 530 tests pass; typecheck and lint clean
- [ ] Not exercised: an actual GitHub Actions run with the variable set (verified with the same
      variable in a local shell)

## Follow-up: `sitemap-url-status` (Phase 4 item 5), 2026-09-30

Built lightweight-mode on the same `SitemapDocuments` artifact; decisions confirmed with the
developer: evenly spread deterministic sample, only 2xx passes (redirects fail), default 10 with
`LHCI_SEO_SITEMAP_SAMPLE_SIZE` (clamped 1-25).

- [x] **Real find, public site** — `https://nodejs.org/en`: 10 of 1,731 listed URLs sampled (8
      other-host URLs skipped, not requested); `score: 0`, 5 of 10 returned 404 (for example
      `/en/blog/release/v010.22`). Confirmed independently with curl (also with a browser User-Agent):
      that URL 404s while `/en/blog/release/v0.10.22` returns 200, so nodejs.org's own sitemap lists
      URLs with the dots stripped. A genuine sitemap bug, not a false positive from this tool.
- [x] **Localhost, opt-in on** — seven listed URLs on `localhost:8851` (two 404/301 entries planted,
      plus one on `elsewhere.example`): 7 of 7 checked; 404 shown as `HTTP 404`, the redirect shown
      as `HTTP 301, redirects to http://localhost:8851/ok1`, the other-host URL counted and never
      requested; `score: 0`
- [x] **Localhost, opt-in off** — `notApplicable` (the sitemap itself is not fetchable; the run
      warning from the private-network opt-in explains why)
- [x] Audit in the `seo-extended` category; config test asserts all 28 audit ids
- [x] Unit tests (47): sample-size parsing and clamping (invalid values fall back to 10); even
      deterministic selection incl. first/last and no repeats; same-origin filtering (other host,
      scheme, port, `www` all skipped); concurrency never above 5; one retry for a network error,
      none for an HTTP status; hard per-request timeout even when the fetcher never settles; total
      time budget marks the rest "not checked"; redirect target recorded and not followed
- [x] seo-audits suite: 577 tests pass; typecheck and lint clean
- [ ] Not exercised live: the total-time-budget path (needs 30 s of slow responses); unit-tested with
      an injected clock only
- [ ] Sample-size variable checked in unit tests only, not in a real CI job

Observation: `safeFetchStatus` now also returns `redirectLocation` for a 3xx response (additive: a
plain `{status}` is returned for everything else, so existing callers and tests are unchanged).

## Follow-up: `sitemap-robots-crossref` (Phase 4 item 8), 2026-09-30

Lightweight mode, no new gatherer or requests: compares `SitemapDocuments` with core's `RobotsTxt`.
Decisions confirmed with the developer: scored on URLs disallowed for Googlebot/Bingbot, a declared
sitemap's own disallowed path is also scored, "audited page missing from the sitemap" is informational.

- [x] **Localhost (opt-in on)** — robots.txt disallows `/private/` and `/sitemap.xml` for `*` and
      `/bing-only/` for Bingbot; the sitemap lists `/`, `/ok`, `/private/a`, `/private/b`,
      `/bing-only/x`. `score: 0`: "3 of 5 sitemap URL(s) are disallowed by robots.txt; 1 sitemap file
      path(s) are disallowed"; rows name Googlebot for `/private/a`, `/private/b` and the sitemap
      path, and **Bingbot only** for `/bing-only/x`. Bingbot is correctly *not* flagged for
      `/private/`: its own group replaces `*` for it. The page is reported as listed.
- [x] **Real sites, pass** — `https://nodejs.org/en`: 1,732 sitemap URLs checked, 8 on another host
      skipped, page reported as not listed (informational, score 1); `https://developer.mozilla.org/en-US/`:
      52,383 URLs checked (all of them, quickly: no requests), page listed, score 1
- [x] In the `seo-extended` category; config test asserts all 29 audit ids
- [x] Unit tests (19): pass; blocked for both crawlers vs one; Allow overriding a broader Disallow;
      AI-crawler-only block ignored; 500 blocked URLs list 20 rows but report the true total; other
      host/scheme/port not checked; declared sitemap path flagged, index-child path not; robots.txt
      404 passes; robots.txt 5xx/unavailable and discovery none/unavailable not-applicable; index and
      failed documents ignored; page-listed tolerates a trailing slash and a fragment
- [x] seo-audits suite: 598 tests pass; typecheck and lint clean
- [ ] **Unverified claim, stated in the audit's own description:** whether search engines apply
      robots.txt to sitemap files. Google's sitemap documentation (developers.google.com,
      `build-sitemap`) does not address it (checked 2026-09-30), so that check is worded as "verify",
      and can be dropped if it proves wrong
- [ ] Not exercised live: robots.txt unavailable (5xx) branch; unit-tested only
