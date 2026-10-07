# Phase 9 — URL Quality

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-9-url-quality` (off `main`), the eighth phase to use the
phase-branch workflow in `AGENTS.md`. Merges into `main` once every item is done.

**Status: Done (2026-10-05): built, QA'd live and merged into `main`; recalibrated on 2026-10-06 (`url-length` is a note above 115 characters, `url-query-parameters` and `url-normalization` are informational).**

## Planning decisions (2026-10-05, lightweight with a short design conversation)

No new gatherer and no new request: the rules are string checks on URLs the crawl already holds, so they read the `SiteCrawl` artifact. Four decisions with the developer:

1. **Scope**: the per-URL rules judge the audited page's URL and list other crawled URLs without failing on them; the site-wide rules (variants) read the crawl.
2. **Thresholds**: more than 115 characters of path and query, or more than 3 query parameters, fails (fixed, stated in the audit text).
3. **Parameters**: a session ID fails; tracking parameters (`utm_*`, `gclid`, `fbclid`...) are a note only.
4. **Variants**: fail when the audited page and another crawled URL differ only by case or trailing slash, both answered 200 as HTML, and their canonicals do not name one URL.

## Features

| # | Roadmap row | Status | Audit |
|---|-------------|--------|-------|
| 1 | URL length / excessive query parameters | **done** | `url-length`, `url-query-parameters` (lib `url-quality.js`) |
| 2 | Session IDs / tracking parameters in URL | **done** | `url-session-tracking` |
| 3 | Repeated slashes / encoding issues | **done** | `url-encoding` |
| 4 | Uppercase vs lowercase URL variants | **done** | `url-case-variants` (lib `crawl-url-variants.js`) |
| 5 | Trailing-slash consistency | **done** | `url-trailing-slash-variants` |
| 6 | URL normalization (multiple URLs, same resource) | **done** | `url-normalization` |

## How the plan changed while building

- **A bug from Phase 7 surfaced in the live run and was fixed first** (`fix(seo-audits)`): when one `lhci collect` audits several URLs of one origin, the later URLs reuse the first URL's cached crawl. If the later URL was already inside that crawl, the snapshot kept the *first* URL's `audited` label, so every cross-page audit (Phases 7 and 8 included) judged the wrong page. The label now moves to the page of the current run, and a page added to a cached snapshot no longer leaves a second `audited` page behind.
- **A quadratic pattern was caught while writing**: trailing-slash stripping with `/\/+$/` is quadratic on a long run of slashes (the Finding 9 shape); it is a loop, with a 200,000-slash test.
- Uppercase letters in the audited path are **not** a failure by themselves (decision 4): the audit is about two live variants.

## Known limits

- Variants are found only when a crawled page links to them or the sitemap lists them; a site that never links its other form shows none. The audits do not guess or probe forms (no extra request).
- A variant that redirects to the main URL is, by design, one page.
- No content comparison: two live variants with different content still fail unless a canonical resolves them (`duplicate-content` covers identical text).
