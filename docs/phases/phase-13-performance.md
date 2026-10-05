# Phase 13 — Performance ↔ SEO Crossover

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-13-performance` (off `main`). Lighthouse core already covers the lab metrics; this phase adds real-visitor data and two crawl-weight reports.

**Status: built and QA'd (2026-10-05); awaiting the merge into `main`.** The CrUX success path (real data) is **not verified**: it needs a real Google API key (open item).

## Planning decisions (2026-10-05, lightweight with a plain-language explanation; the developer had no CrUX background)

1. **Build all three roadmap rows**, with the field-data audit **off unless an API key is set**, and the two crawl-weight rows as **informational reports only** (no threshold exists).
2. Choices made and stated without a question: URL first then origin; p75 against Google's documented thresholds; fail only on "poor"; missing data, no key or an API error is "not applicable"; the key goes in a header and is never logged, stored or put in an error; the page's query string and fragment are never sent; non-public addresses are never sent.

## Features

| Roadmap row | Status | Audit |
|---|---|---|
| Core Web Vitals field data via CrUX | **done** | `core-web-vitals-field` (scored, off without `LHCI_SEO_CRUX_API_KEY`) |
| Render-blocking resources' impact on crawl budget | **done** | `render-blocking-report` (informational) |
| Excessive resource requests | **done** | `request-weight-report` (informational) |

Code: `lib/crux-client.js` (the Google call), `gatherers/field-data.js`, `lib/field-vitals.js`, `lib/page-weight.js`, three thin audits.

## How the plan changed while building

- Lighthouse's network records in this version have no render-blocking flag, so "render-blocking" is read from the raw HTML (sync scripts and screen stylesheets in the head) and joined to sizes from the network log. It is documented as an approximation.
- No cache for the CrUX answer: a run asks at most twice (URL, then origin); with three runs per URL that is well inside Google's quota. Add a cache if that ever matters.

## Known limits

- CrUX has no data for small or new sites, so the audit is often "not applicable".
- CrUX data is a 28-day rolling window: a fix shows up there only after weeks.
- The page's query string is dropped, so a page whose data depends on a query string is judged at its path.
- Render-blocking is an HTML approximation (no preload scanner, no `fetchpriority`).
