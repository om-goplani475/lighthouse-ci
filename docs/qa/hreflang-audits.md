# QA — hreflang audits (Phase 11)

`hreflang-codes`, `hreflang-return-links`, `hreflang-alternate-status`, `hreflang-canonical` (scored); `hreflang-x-default`, `hreflang-sitemap-consistency`, `hreflang-locale-meta` (informational).

## Verified (2026-10-05)

- [x] Unit tests for every piece: `test/lib/hreflang-codes.test.js` (valid and invalid values, suggestions, the runtime locale data), `hreflang-extract` (the head reader), `hreflang-checks` (bounds, user-agent, other hosts through the public-only fetch, dedupe, limit, errors as data, one request at a time per host, the time budget), `hreflang-static`, `hreflang-network` (every status and error class as a failure or a note), `hreflang-sitemap`, `url-key`, the sitemap `xhtml:link` capture (parser and gatherer), `test/gatherers/hreflang-data.test.js`. `seo-audits`: 101 suites / 1,883 tests, typecheck and lint clean.
- [x] Live `lhci collect` with the fork config against a planted site (port 9522, a spy server on 9523):

  | Page | Result |
  |---|---|
  | `/en/` (a correct set: en, fr, x-default; the sitemap lists en and fr) | all four scored audits pass; the sitemap audit notes the x-default is not in the sitemap; the locale audit notes `og:locale` is `fr_FR` |
  | `/bad/` (en-UK; a 404, a redirecting, a noindex and a no-return-link alternate; one with no tags; a wrong canonical; a cross-origin alternate) | `hreflang-codes` fails with "use en-gb"; `hreflang-return-links` fails on the one alternate with tags and none back (two without tags are notes); `hreflang-alternate-status` fails on 404, redirect and noindex (the cross-origin one is a note: private address, not requested); `hreflang-canonical` fails (canonical is the French version) |

- [x] **Spy proof:** with `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`, an alternate on another origin at a private address (`localhost:9523`) was **never requested** (the spy server's log was empty).

## Not verified

- Real multi-domain sites (ccTLDs, subdomains), CDNs that serve bots differently, and hreflang only in HTTP headers or only in the sitemap (the audits are designed to note rather than fail on these).
- `packages/viewer` rendering of these tables.
