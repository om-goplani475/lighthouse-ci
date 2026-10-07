# Phase 11 — International SEO (hreflang)

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-11-hreflang` (off `main` at the Phase 12 merge, `7704251`). The ninth phase branch to be started after Phase 8; Phase 11 was first skipped (the developer started Phase 12 instead), then started on 2026-10-05.

**Status: Done (2026-10-05), merged into `main`.** It was paused at about 30% (the sitemap capture, `looseKey` and the head extractor) while Phase 13 was built, then resumed and finished on the same day. The sections below that describe "still to build" are kept as the record of the plan; all of it is now built.

## Planning decisions (2026-10-05, lightweight with a short design conversation, all four confirmed)

1. **Requests**: up to 10 alternates of the audited page are fetched (status plus the first 64 to 128 KiB). Same-origin alternates go through the normal safe fetch (honours `LHCI_SEO_ALLOW_PRIVATE_NETWORK`); alternates on other hosts (ccTLD and subdomain setups are the norm) go through the strict public-only fetch, as external links do. Own user-agent, no cookies, no redirect followed.
2. **Seven audits** (all four groups chosen): code validation; reciprocity and alternate status; x-default and canonical conflicts; sitemap cross-validation and locale meta.
3. **Strictness (informed by the 2026-10-05 review that found we fail too much)**: fail only on objective defects. Fail: invalid language or region code, no self-reference, an alternate that does not link back, an alternate answering 404/410 or redirecting or noindex, hreflang pointing at a non-canonical URL. Notes only (informational audits): a missing x-default, `lang`/`content-language`/`og:locale` mismatches, sitemap differences.
4. **No hreflang on the page**: every hreflang audit is not applicable.

## Built and tested (on the branch, uncommitted when this was written; 91 suites / 1,773 tests green, typecheck and lint clean)

| Piece | Files | Notes |
|---|---|---|
| Sitemap capture of `<xhtml:link rel="alternate" hreflang>` for the audited URL only | `src/lib/sitemap-parse.js` (`targetEntry` on `SitemapDocument`, `parseSitemapBytes(..., {target})`), `src/gatherers/sitemap-documents.js` (threads the audited URL to the parser), tests in `test/lib/sitemap-parse.test.js` and `test/gatherers/sitemap-documents.test.js` | Capped at 100 alternates; handles `<loc>` before or after the links; null when the page is not listed or for an index. No new request. |
| Loose URL key (trailing slash and fragment ignored, path case kept) | `src/lib/url-key.js`, `test/lib/url-key.test.js` | Linear on a 200,000-slash path. Used to compare "same page". |
| Head extractor for hreflang, canonical and robots meta | `src/lib/hreflang-extract.js`, `test/lib/hreflang-extract.test.js` | Streaming `htmlparser2` over the part before `<body>`; dedupes, caps at 100; does not read HTTP `Link` headers. |

## Built after the resume (the plan, as executed)

1. **`src/lib/hreflang.js`, the pure library.**
   - `parseHreflang(value)`: `x-default`, or `language[-script][-region]`. Language must be an ISO 639-1 two-letter code (also accept the retired `iw`, `in`, `ji`); a three-letter code (ISO 639-2) fails with the two-letter suggestion (`eng` to `en`); a script is any 4-letter subtag; a region is an ISO 3166-1 alpha-2 code or a 3-digit UN M.49 code (`es-419`); an underscore (`en_US`) fails with the hyphen suggestion; a bare region (`GB`) fails with "needs a language first"; common mistakes get a suggestion (`en-UK` to `en-GB`). Case is not significant.
   - Builders: `buildCodesProduct`, `buildReturnLinksProduct`, `buildAlternateStatusProduct`, `buildCanonicalProduct`, `buildXDefaultProduct`, `buildSitemapProduct`, `buildLocaleMetaProduct`, each returning `notApplicable` when the page has no hreflang.
   - Write it in several small files or in pieces: the first attempt to write it as one very large block was rejected by the API's content filter ("Output blocked by content filtering policy"); the cause was not identified (the long ISO code lists are the suspect).
2. **`src/gatherers/hreflang-data.js` and its test.** In-page: the `link[rel~=alternate][hreflang]` list from the head (absolute), the page's canonical, `<html lang>`, `meta[http-equiv=content-language]` and `meta[property=og:locale]`. Then fetch up to `LHCI_SEO_HREFLANG_MAX_CHECKS` (default 10, `0` switches it off) distinct alternates other than the page itself: hosts in parallel (at most 5), one request at a time per host, 128 KiB, about 5 s each, about 20 s total; reuse `errorCodeOf` from `external-link-checker.js`; parse each with `extractHreflangHead`. Per alternate record: `url`, `hreflang`, `sameOrigin`, `status`, `redirectLocation`, `error`, `bodyRead`, `noindex`, `canonicals`, `alternates`, `hasHreflang`, `truncated`.
3. **Seven audits** (thin modules over the builders): `hreflang-codes`, `hreflang-return-links`, `hreflang-alternate-status`, `hreflang-canonical` (scored) and `hreflang-x-default`, `hreflang-sitemap-consistency`, `hreflang-locale-meta` (informational). Register in `src/lighthouse-config.js` (gatherer `HreflangData`; the audits that read the sitemap also need `SitemapDocuments`) and `test/lighthouse-config.test.js`. Avoid a hyphen followed by a digit in any id.
4. **Live QA**: a planted multi-language site (a correct set; a missing return link; a redirecting alternate; a 404 alternate; a noindex alternate; a canonical pointing at another language; a bad code such as `en-UK`; hreflang only in the sitemap), `lhci collect` and `lhci assert`, with the private-network opt-in; plus a spy-server proof that a cross-origin alternate to a private address is never requested.
5. **Security pass, README (a "Hreflang audits" section and the new environment variable), QA doc, `security-findings.md`, changelog, current-phase.**

## Calibration rules to keep (so the audits do not repeat the over-strictness the review found)

- A page whose alternates return **no hreflang tags in their HTML** is **not** a failed return link: the return tags may be in HTTP headers or only in the sitemap. Fail a return link only when the alternate has hreflang tags and none points back; otherwise a note.
- Compare "same page" with `looseKey` (trailing slash and fragment ignored).
- 401, 403, 429, 5xx, timeouts and TLS errors on an alternate are **notes, not failures** (bot protection and transient errors), as `broken-external-links` does. Fail on 404/410, DNS failure or refused connection, a redirect (3xx) and a noindex.
- `x-default` is optional for Google: informational only.
- Headers-only hreflang (HTTP `Link`) is not supported for the fetched alternates; core's own `hreflang` audit covers the syntax of header links on the audited page. Say so in the README.

## Open questions for when this is resumed

- Whether to read hreflang from the audited page's HTTP `Link` header too (Lighthouse's `LinkElements` has it with `source: 'headers'`); today's plan reads the head only.
- Whether `hreflang-return-links` and `hreflang-alternate-status` should become one audit with two failure kinds (the developer chose "Reciprocity + alternate status" as one group).


## Closing record (2026-10-05)

Built after the resume, with the files as they landed:

- `src/lib/hreflang-codes.js`: `parseHreflang`. **Deviation from the plan:** no list of ISO language and region codes is typed in; whether a code exists is answered by `Intl.DisplayNames` (the runtime's locale data), which also removed the suspected trigger of the two API content-filter rejections that interrupted the first attempt. A reserved region (`ZZ`) is refused; `UK` is refused with `GB`.
- `src/lib/hreflang-checks.js` (the bounded requests), `src/gatherers/hreflang-data.js` (the page's links, canonical, `lang`, `content-language`, `og:locale`, and the checks; `LHCI_SEO_HREFLANG_MAX_CHECKS`).
- The builders were split by topic: `hreflang-common.js`, `hreflang-static.js` (codes, x-default, locale meta), `hreflang-network.js` (return links, alternate status, canonical), `hreflang-sitemap.js`.
- Seven thin audits: `hreflang-codes`, `hreflang-return-links`, `hreflang-alternate-status`, `hreflang-canonical` (scored) and `hreflang-x-default`, `hreflang-sitemap-consistency`, `hreflang-locale-meta` (informational).
- The open question about HTTP `Link` headers was settled as: not read (the alternates are fetched as a prefix that does not keep that header); stated in the README. The question about one audit versus two for return links and status was settled as two (separate assert keys, different failure kinds).

Live QA against a planted site: the good page passed everything; the broken page failed codes (`en-UK`, with the `en-GB` fix), return links (one alternate does not link back; two with no tags only noted), alternate status (404, redirect, noindex failed; a cross-origin alternate to a private address was only noted), and canonical (the canonical pointed at the French version). A spy server on the other origin saw **zero** requests with the private-network opt-in on. Details in `docs/qa/hreflang-audits.md`.
