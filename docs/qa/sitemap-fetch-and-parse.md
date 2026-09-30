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
