# Audit spec: Sitemap Fetch and Parse

- slug: sitemap-fetch-and-parse
- upstream-sync checked against: lighthouse@12.6.1 (installed `node_modules/lighthouse`, unchanged
  since Phase 3). This checkout has no `upstream` remote configured (only `origin`), so there was
  no upstream range to skim for a changelog — the check was against the installed package source.

## Upstream-sync findings (Step 0)

1. **`BaseGatherer`** (`core/gather/base-gatherer.js`): `meta = {supportedModes}`, `getArtifact(passContext)`.
   Same shape `favicon-links.js` already uses. No drift.
2. **Gatherer dependencies cannot target `RobotsTxt`.** `config.js:168` only registers a gatherer for
   dependency resolution when its `meta.symbol` is set, and only `DevtoolsLog`, `Trace`, `Scripts`
   and `SourceMaps` declare one (`grep "static symbol" core/gather/gatherers`). Core's `RobotsTxt`
   gatherer has none, so `meta.dependencies` cannot receive it. This resolves the spec's first open
   question: **the gatherer fetches robots.txt itself** through `safe-fetch.js`. Side effect worth
   knowing: core's `RobotsTxt` fetches through the browser (`driver.fetcher`), ours through Node's
   SSRF-protected path, so the two may disagree in odd cases (e.g. a WAF treating a browser and a
   Node client differently).
3. **Gatherer inputs available**: `passContext.baseArtifacts.URL.finalDisplayedUrl` gives the origin;
   no browser/CDP access is needed at all.
4. **LHR shape**: purely additive (new audits under `lhr.audits`, new refs in the existing
   `seo-extended` category). The raw sitemap artifact lives in `artifacts.json`, never in the LHR.
5. **Testing constraint carried forward**: `safe-fetch.js` refuses private/loopback addresses, so
   `lhci collect` against a `localhost` page cannot reach a local sitemap. Live QA must use real
   public sites; failure-path behavior is verified by driving the gatherer's fetch/parse core against
   a local server with the test-only permissive lookup (the same technique `safe-fetch.test.js`
   already uses), not by weakening the SSRF policy.

## Decisions (developer, 2026-09-30, blocking questions)

- Discovery: robots.txt `Sitemap:` lines, else probe `/sitemap.xml` (Gate 0).
- Cross-origin `Sitemap:` URLs **are fetched**, through safe-fetch, subject to the per-run caps.
- Redirects are **reported, not followed**; `safe-fetch.js`'s no-redirect policy is unchanged.
- Parser `saxes`; one gatherer, three audits (Gate 0).

## Gatherer

- New gatherer: `SitemapDocuments` (`src/gatherers/sitemap-documents.js`), supportedModes
  `['navigation', 'snapshot']`. No dependencies.
- Data collected: everything the three audits (and later the URL-status sample and cross-checks)
  need about each sitemap document, so nothing downstream re-fetches. See the artifact shape below.
- Collection method: Node-side HTTP through `src/lib/safe-fetch.js` (new export, below), streaming
  gunzip when needed, streaming `saxes` parse. No CDP/DOM use.

### Discovery

1. Fetch `/robots.txt` on the origin of `finalDisplayedUrl` (through safe-fetch). Take its `Sitemap:`
   values (existing `parseRobotsTxt` in `lib/robots-txt.js`); resolve relative values against the
   robots.txt URL? **No** — the protocol requires absolute URLs and `robots-txt-sitemap-declared`
   already flags relative ones, so relative/non-http(s) values are ignored here (recorded in
   `ignoredSitemapLines` so `sitemap-valid` can say so).
2. If robots.txt is present and declares ≥1 valid URL: `discovery = 'robots-txt'`. At most
   `MAX_DECLARED = 5` declared URLs are used (order preserved, duplicates dropped).
3. If robots.txt is absent (4xx) or declares none: probe `/sitemap.xml` on the same origin.
   200 → `discovery = 'default-location'`. 404/410 → `discovery = 'none'`. Any other status or a
   network error → `discovery = 'unavailable'` (nothing can be concluded).
4. If robots.txt itself is 5xx/network error: `discovery = 'unavailable'` (no probing).

### Fetch, decompress, parse (per document)

- One request per document, `GET`, `Accept-Encoding: identity` is *not* forced: a `.xml.gz` URL or
  `Content-Encoding: gzip`/gzip magic bytes (`1f 8b`) are gunzipped; transport-level encoding beyond
  that is left to the server (no `br`/`deflate` requested).
- No redirects followed. A 3xx yields `outcome: 'redirect'` with the `Location` value recorded.
- Caps (module constants, documented, not user-configurable in v1):
  - `MAX_DOCUMENTS = 10` total documents fetched per run (declared roots first, then index children
    breadth-first). Hitting the cap sets `documentsTruncated: true`.
  - `MAX_CHILD_SITEMAPS_FOLLOWED = 9` per run (part of the same 10). One level only: a `<sitemap>`
    entry inside an index-child that is itself an index is recorded but not fetched.
  - `MAX_COMPRESSED_BYTES = 15 * 1024 * 1024` read from the wire.
  - `MAX_UNCOMPRESSED_BYTES = 50 MiB + 1` (`52_428_801`): decompression/parse stops at this point,
    setting `exceededUncompressedLimit: true`. One byte over the protocol limit is what lets
    `sitemap-limits` *detect* an oversized file without downloading an unbounded amount (gzip-bomb
    protection). The recorded `uncompressedBytes` is then "at least this many".
  - `MAX_ENTRIES_STORED = 50_001`: parsing stops after the 50,001st `<loc>`, setting
    `entriesTruncated: true` (again: enough to prove "over 50,000" without holding an unbounded list).
  - `REQUEST_TIMEOUT_MS = 10_000` per request (sitemaps are larger than manifests; robots.txt uses
    5 s like existing safe-fetch defaults).
- Parse with `saxes` in strict mode with XML-namespace handling (`xmlns: true`) so the root
  element's namespace can be checked. Collect `<loc>` text of `<url>` (urlset) or `<sitemap>` (index)
  children only; ignore other namespaced extension elements (`image:`, `video:`, `news:`,
  `xhtml:`), tolerated, not validated. First parse error is recorded with line/column and parsing
  stops (a strict XML parser cannot meaningfully continue past a well-formedness error).
- Entry-level checks (recorded, not stopping): a `<loc>` that is empty, not an absolute `http(s)` URL,
  or over 2,048 characters (protocol limit is 2,048) goes to `invalidLocs` (capped at 20 examples,
  with `invalidLocCount` for the true total).

### Artifact shape (`artifacts.SitemapDocuments`)

```js
/**
 * @typedef {{
 *   url: string,
 *   source: 'declared' | 'default-location' | 'index-child',
 *   parentUrl: string | null,
 *   outcome: 'ok' | 'http-error' | 'redirect' | 'network-error' | 'decompression-error',
 *   status: number | null,
 *   redirectLocation: string | null,
 *   errorMessage: string | null,
 *   gzip: boolean,
 *   compressedBytes: number,
 *   uncompressedBytes: number,
 *   exceededUncompressedLimit: boolean,
 *   kind: 'urlset' | 'sitemapindex' | 'invalid' | null,   // null when nothing was parsed (outcome != ok)
 *   namespaceOk: boolean,
 *   parseError: {message: string, line: number, column: number} | null,
 *   locs: string[],                // <url><loc> (urlset) or <sitemap><loc> (index), up to MAX_ENTRIES_STORED
 *   entryCount: number,            // == locs.length unless entriesTruncated
 *   entriesTruncated: boolean,
 *   invalidLocs: Array<{value: string, reason: string}>,
 *   invalidLocCount: number,
 * }} SitemapDocument
 *
 * @typedef {{
 *   discovery: 'robots-txt' | 'default-location' | 'none' | 'unavailable',
 *   ignoredSitemapLines: string[],   // robots.txt Sitemap values that were relative/non-http(s)
 *   documentsTruncated: boolean,
 *   documents: SitemapDocument[],
 * }} SitemapDocumentsArtifact
 */
```

Failure isolation: every per-document error (HTTP, network, gunzip, parse) is caught and recorded as
data; the gatherer only throws on a programming error, which Lighthouse then surfaces as an errored
artifact (each audit reports an error, never a false pass).

### New export in `src/lib/safe-fetch.js`

`safeFetchBytes(url, {timeoutMs, maxBytes})` → `{status, headers, body: Buffer, redirectLocation}`:
identical URL/scheme/literal-IP/`safeLookup`/no-redirect protections as `safeFetchJson`, but returns
the raw bytes (non-2xx statuses are *returned*, not thrown, because the caller needs the status)
and rejects when `maxBytes` is exceeded. As with the other exports, an inner
`fetchBytesWithLookup(url, lookup, opts)` takes the lookup so tests can use a permissive one;
there is still no way for a real caller to pass a weaker lookup. Streaming gunzip with a byte cap is
done by the gatherer's pure core on top of this (`lib/sitemap-parse.js`), so the cap applies to
*decompressed* output.

## Audits (three, thin, scored binary, all read only `SitemapDocuments`)

All three are `notApplicable` when `discovery` is `'none'` or `'unavailable'` (a missing sitemap is
`robots-txt-sitemap-declared`'s concern; an unreachable network proves nothing).

### `sitemap-valid` (roadmap item 4)

- Scoring: `score 1` when every document is `outcome: 'ok'`, `kind` is `urlset`/`sitemapindex`,
  `namespaceOk`, `parseError` is null, and `invalidLocCount` is 0. Otherwise `score 0`.
- Failure reasons, each listed as a row: HTTP error status (with code); redirect (with the
  `Location`, "declare the final URL"); network error; gunzip error; XML not well-formed
  (message + line/column); wrong root element; missing/incorrect namespace
  `http://www.sitemaps.org/schemas/sitemap/0.9`; invalid `<loc>` (with reason, first few examples).
  Also reported, without failing: robots.txt `Sitemap:` lines ignored for being relative/non-http.
- `DetailsType`: `table` (Sitemap URL, Problem, Detail).

### `sitemap-duplicate-urls` (roadmap item 6)

- Scoring: `score 0` if any single `urlset` document lists the same `<loc>` more than once,
  else `score 1`. Comparison is **exact string equality after trimming whitespace** (no trailing-slash,
  case, fragment or default-port folding: those are not universally equivalent, and a false positive
  here would be unfair). Documented in the audit description. Duplicates *across* separate sitemap
  files are not flagged (not an error under the protocol, and common with index files).
- Skips documents that are not `ok`/`urlset`; a document with `entriesTruncated` is checked over
  the stored portion and noted as partial.
- `DetailsType`: `table` (Sitemap URL, Duplicated URL, Times listed), capped at 20 rows with the true
  total in `explanation`.

### `sitemap-limits` (roadmap item 7)

- Scoring: `score 0` if any document has more than 50,000 entries (urlset URLs, or an index's child
  sitemaps), or `exceededUncompressedLimit` (over 50 MiB uncompressed). Else `score 1`.
- Reported informationally in the table for every document: gzip yes/no, compressed and
  uncompressed size (as "over 50 MiB" when capped), entry count, kind. If `documentsTruncated` or an
  index was not fully followed, the explanation says only the first N documents were checked; that is
  never presented as a pass for the unchecked ones.
- `DetailsType`: `table` (Sitemap URL, Type, Entries, Size, Gzip, Limit status).

## Category placement

- Category: existing `seo-extended` (this fork's own), no change to core categories.
- Weight: 1 each for `sitemap-valid`, `sitemap-duplicate-urls`, `sitemap-limits`.

## Extension point

`packages/seo-audits/src/lighthouse-config.js` (referenced via `.lighthouserc.js`'s `configPath`):
add `{id: 'SitemapDocuments', gatherer: './gatherers/sitemap-documents.js'}` to `artifacts`, the three
audit paths to `audits`, and three refs to `categories['seo-extended'].auditRefs`. Same mechanism as
`FaviconLinks`; `extends: 'lighthouse:default'` retained. `plugins` cannot register a gatherer
(`lighthouse-conventions.md`).

## Risks / open questions

- **Security surface (highest in Phase 4)**: outbound fetches to URLs named by the audited site's
  robots.txt and, for an index, by sitemap content. Protections: scheme allowlist, post-DNS
  private-IP blocking, DNS-rebinding-resistant lookup, no redirects, per-request timeout and byte
  caps, decompressed-size cap (gzip bomb), per-run document cap, stored-entry cap. Cross-origin
  fetching is permitted by decision; the residual risk is up to 10 bounded GETs to public URLs of the
  audited site's choosing. `/security-review` must specifically exercise: a `Sitemap:` line pointing
  at `http://169.254.169.254/`, a gzip bomb, an index with hundreds of children, a very slow
  response, a redirect to an internal address, and a `<loc>`-flood document.
- **Memory**: 50,001 stored strings ≈ a few MB per document worst case, ×10 documents ≈ tens of MB in
  `artifacts.json`. Acceptable, but `artifacts.json` growth is worth noting if runs are stored by
  LHCI server (the LHR itself stays small: only capped table rows).
- **Streaming parse correctness**: `saxes` is fed chunks; a parse error must stop consumption and
  cancel the request/gunzip stream rather than buffering the rest.
- **Byte-cap vs. ratio**: the compressed cap (15 MiB) and decompressed cap (50 MiB + 1) bound memory
  independently; a hostile 15 MiB gzip that expands >1000× stops at the decompressed cap.
- **Duplicate/edge semantics** recorded above (exact-string, per-document) are deliberate and
  documented in the audit descriptions, not left implicit.
- **Testing**: pure core (`lib/sitemap-parse.js`: gunzip-capped, saxes parse, loc validation,
  limits) is unit-tested with in-memory buffers; the gatherer's orchestration with an injected
  fetcher; fetch behavior against a local server via the permissive lookup; audits from fixture
  artifacts. No test touches a live URL. Live `lhci collect` QA against real public sites (a valid
  sitemap, an index, a site with no sitemap); failure paths verified through the local-server driver.
- **Gatherer imports `saxes`** (declare `"saxes": "^6.0.0"` in `packages/seo-audits/package.json`;
  confirm the installed 6.0.0 satisfies it and that `yarn.lock` needs no new entry).
