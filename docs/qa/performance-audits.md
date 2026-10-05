# QA — performance and field-data audits (Phase 13)

`core-web-vitals-field`, `render-blocking-report`, `request-weight-report`.

## Verified (2026-10-05)

- [x] Unit tests: `test/lib/crux-client.test.js` (key in a header only, 404/403/429/500, key never in an error or bad-JSON message), `test/gatherers/field-data.test.js` (off without a key and no request, query string dropped, URL then origin, no data, API error, non-public addresses never sent, an unusable record), `test/lib/field-vitals.test.js` (every threshold at its boundary, needs-improvement not failed, FCP and TTFB not judged, missing INP, not-applicable reasons), `test/lib/page-weight.test.js`. `seo-audits`: 93 suites / 1,788 tests, typecheck and lint clean.
- [x] Live `lhci collect` with the fork config against a planted site (port 9521: a sync stylesheet, two sync scripts, an async and a deferred script): `render-blocking-report` listed exactly the stylesheet and the two sync scripts with sizes (async and defer excluded); `request-weight-report` gave 7 requests, 78 KiB by type; `core-web-vitals-field` was not applicable ("set LHCI_SEO_CRUX_API_KEY"); with a key set it was not applicable too ("the audited address is not a public web site, so nothing was sent to Google"); the key did not appear anywhere in the report.
- [x] The real HTTPS path to `chromeuxreport.googleapis.com` with an obviously fake key and the public URL `https://example.com/`: Google answered 400, the audit reported "the CrUX API answered 400 (check the key and that the Chrome UX Report API is enabled for it)", and the key was not in the result.

## Not verified

- **The success path with real data** (parsing a real CrUX response, the table, the p75 judgement on real numbers): needs a real API key and a public site that CrUX covers. The response shape was written from Google's documented format and unit-tested only.
- Behaviour against the API quota under many parallel runs.
- `packages/viewer` rendering of these tables.
