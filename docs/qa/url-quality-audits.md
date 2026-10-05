# QA — URL quality audits (Phase 9)

Seven audits: `url-length`, `url-query-parameters`, `url-session-tracking`, `url-encoding`, `url-case-variants`, `url-trailing-slash-variants`, `url-normalization`.

## Verified (2026-10-05)

- [x] **Unit tests**: `test/lib/url-quality.test.js` and `test/lib/crawl-url-variants.test.js` (limits at the boundary, session versus tracking, ambiguous names, encoding cases, canonical-resolved groups, non-live variants, the row caps, applicability, a 200,000-slash timing test); the crawler test gained two for the cached-label fix. `seo-audits`: 84 suites / 1,703 tests, typecheck and lint clean.
- [x] **Live `lhci collect` / `lhci assert`** against a planted site (port 9517) with the fork config, five audited URLs of one origin in a row (so four reused the cached crawl):

  | Audited URL | Failed (as expected) | Passed |
  |---|---|---|
  | `/About` (a live `/about`) | `url-case-variants`, `url-normalization` | the other five |
  | `/dir/` (a live `/dir`) | `url-trailing-slash-variants`, `url-normalization` | the other five |
  | `/clean` | none | all seven (other pages' groups are listed) |
  | `/canon-a` (case twin with one canonical) | none | all seven |
  | `/bad//p%25zz/<120 chars>?PHPSESSID=..&a..d&utm_source` | `url-length`, `url-query-parameters`, `url-session-tracking`, `url-encoding` | the three variant audits |

- [x] The first run of this table failed `/clean` on the case audit: the cached crawl still named `/About` as the audited page. That is the Phase 7 cache bug now fixed (see the phase doc); the table above is after the fix.

## Not verified

- Behaviour on real sites (A6 in `docs/open-items.md` covers these audits too): which real sites link both forms of a URL, and whether 115 characters is noisy on long-slug blogs.
- `packages/viewer` rendering of the new tables (A1).
