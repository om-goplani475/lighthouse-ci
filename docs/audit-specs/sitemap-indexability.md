# Audit spec: Sitemap vs Indexability

- slug: sitemap-indexability
- upstream-sync checked against: lighthouse@12.6.1 (installed `node_modules/lighthouse`, unchanged
  since the sitemap work earlier the same day). This checkout has no `upstream` remote, so the check
  was against the installed package source.

## Upstream-sync findings (Step 0)

1. **Extension API unchanged.** `BaseGatherer`, `getArtifact(passContext)`, `baseArtifacts.URL` and
   `baseArtifacts.LighthouseRunWarnings` are as used by the existing gatherers. No drift.
2. **Gatherer dependencies still cannot receive another fork gatherer's artifact.** Only gatherers with
   a `meta.symbol` can be depended on, and `grep "static symbol" core/gather/gatherers` still finds only
   the core ones (DevtoolsLog, Trace, Scripts, SourceMaps). This is why the sampling cannot be a
   separate gatherer without redoing discovery (see Decisions).
3. **LHR shape**: purely additive (one new audit under `lhr.audits`, one new ref in the existing
   `seo-extended` category). The sampled-page data lives in `artifacts.json`, not the LHR.
4. **A ready HTML parser exists in the tree**: `parse5@7.1.2` (via `jsdom`), pure JS, dual CJS/ESM,
   ships its own types. `yarn.lock` already contains the `parse5@^7.1.1` range, so declaring
   `"parse5": "^7.1.1"` in `packages/seo-audits/package.json` needs no lockfile change.
5. **Existing directive parsing** (`src/lib/robots-directives.js`): `parseDirectives(content)` splits on
   commas and on `:`; it has no notion of a user-agent scope, so `googlebot: noindex` parses as key
   `googlebot`. `INDEX_BLOCKING_DIRECTIVES = {noindex, none}`. The existing audits must not change.

## Decisions (developer, 2026-09-30)

- One shared page fetch; `sitemap-url-status` refactored onto it; no extra requests (Gate 0).
- noindex: generic *and* Googlebot/Bingbot-scoped; canonical elsewhere fails except trailing-slash-only
  (Gate 0 questions).
- **Placement: extend the existing `SitemapDocuments` gatherer** with a `urlSample` section, rather than
  a separate gatherer that would redo robots.txt and sitemap discovery (double sitemap traffic).
  Consequence accepted: the gatherer does more and runs longer, and `sitemap-url-status` becomes a pure
  function of the artifact (no network in the audit).
- **HTML head via `parse5`** (declared dependency, no lockfile change), not a hand-written scanner.

## Gatherer

- Gatherer: **`SitemapDocuments`, extended** (`src/gatherers/sitemap-documents.js`). No new gatherer
  and no change to its registration or its `supportedModes`.
- New artifact section `urlSample` (see shape). Collected **after** the documents, only when
  `discovery` is `robots-txt` or `default-location`, and only from documents that are fetched,
  parsed `urlset`s.
- Collection method: Node-side HTTP through `src/lib/safe-fetch.js`, one new export
  (`safeFetchPrefix`, below); bodies are parsed with `parse5` and **reduced to signals in the gatherer**;
  raw HTML is never stored in the artifact.

### Sample selection and bounds (unchanged from `sitemap-url-status`)

Reuses `src/lib/sitemap-url-sample.js` as is: `collectEligibleUrls` (same-origin only, de-duplicated,
document order), `resolveSampleSize` (`LHCI_SEO_SITEMAP_SAMPLE_SIZE`, default 10, clamped 1-25),
`pickEvenly` (deterministic, first and last included), and `checkUrls` (5 at a time, 5 s hard timeout
per request, one retry for a network error only, 30 s total budget, "not checked" for the rest).
`checkUrls` is generalized only to pass through whatever the injected fetcher returns (today it keeps
just `status` and `redirectLocation`), so its behavior and tests are otherwise unchanged. The sample size
is now resolved when the gatherer runs and recorded in the artifact.

### New export in `src/lib/safe-fetch.js`: `safeFetchPrefix`

`safeFetchPrefix(url, {timeoutMs = 5000, maxBytes = 64 * 1024})` resolves
`{status, redirectLocation, headers, body, bodyRead, truncated}`:

- Same URL/scheme/literal-IP/`safeLookup`/no-redirect protections and the same
  `isBlockedAddress` decision point as its siblings; a private-network opt-in applies identically.
- Sends `Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5` and **`Accept-Encoding: identity`**
  (Node does not decompress, and the prefix of a gzip stream is not HTML).
- `headers` is an allowlist only: `x-robots-tag` (**every** occurrence, taken from `rawHeaders` so
  repeated headers are not merged), `content-type`, `content-encoding`, `location`. Names lowercased,
  values arrays of strings.
- The body is read **only** for a 2xx response whose `Content-Type` is `text/html` or
  `application/xhtml+xml` (or absent, since browsers sniff) **and** whose `Content-Encoding` is absent or
  `identity`. Otherwise it destroys the response immediately and reports
  `bodyRead: 'skipped-status' | 'skipped-not-html' | 'skipped-compressed'` (the headers are still
  returned, so an `X-Robots-Tag` on a PDF or a compressed page is still seen).
- Reading stops at `maxBytes`: the request is destroyed and the promise **resolves** (not rejects) with
  `truncated: true` and the bytes read so far. A stalled body after headers resolves the same way at the
  deadline. A failure before headers (timeout, refusal, network error) rejects, as elsewhere.
- Total wall-clock deadline `timeoutMs`, same reasoning as `safeFetchBytes`. Inner
  `fetchPrefixWithLookup(url, lookup, opts)` exported for tests, like its siblings; no way for a caller to
  weaken the lookup.

### HTML signal extraction: `src/lib/html-head-signals.js` (pure)

`extractHeadSignals(body, {truncated})` decodes the prefix as UTF-8, `parse5.parse`s it (default
scripting-enabled tree construction, so `<noscript>` content is text and ignored, matching what a
JavaScript-running crawler sees) and reads the **`<head>` children only**:

- `metas`: `<meta name>` where the lowercased name is `robots`, `googlebot` or `bingbot`, as
  `{name, content}` (content capped at 1,000 characters); at most 20 kept.
- `canonicals`: the `href` of every `<link>` whose whitespace-split `rel` tokens include `canonical`
  (case-insensitive); at most 5 kept; an empty href is dropped.
- `headComplete`: `true` when the head is known to have been read in full: not truncated, or the parsed
  `<body>` already has content (the parser moved past the head). When `false`, the audit must not treat
  "no noindex found" as proof there is none.
- A `<meta>` or `<link>` in the body is ignored (not honored by search engines either).
- Never throws; unparseable input yields empty signals with `headComplete` as computed.

### Scoped directive evaluation (additive, `src/lib/robots-directives.js`)

New export `noindexFor(crawlers, {metas, xRobotsTag})`; **existing exports unchanged**. For each crawler
in `['googlebot', 'bingbot']`, it reports whether indexing is blocked and by what:

- **Meta**: a tag applies if its name is `robots` (all crawlers) or equals the crawler's name; its
  `content` is evaluated with the existing `parseDirectives` + `blocksIndexing` (`noindex` or `none`).
- **`X-Robots-Tag`**: each header occurrence is evaluated on its own. If its first colon-separated
  part (lowercased) is a **known directive key** (`index`, `noindex`, `follow`, `nofollow`, `none`,
  `all`, `nosnippet`, `noarchive`, `notranslate`, `noimageindex`, `max-snippet`, `max-image-preview`,
  `max-video-preview`, `unavailable_after`, `indexifembedded`), the whole value is **unscoped** (this is
  how `max-snippet: 20` and `unavailable_after: date` are told apart from `googlebot: noindex`). Otherwise
  the first part is a **user-agent scope** applying to the rest of that header value
  (`googlebot: noindex, nofollow`). A scope other than `googlebot` or `bingbot` is ignored.
  Documented limitation: a scope is recognized only at the start of a header value.
- Result per blocked crawler: `{crawler, via}` with `via` such as `X-Robots-Tag header`, `<meta
  name="robots">`, `<meta name="googlebot">`. `unavailable_after` and every non-blocking directive are
  ignored.

### Artifact shape (`artifacts.SitemapDocuments.urlSample`, additive)

```js
/**
 * @typedef {{
 *   url: string,
 *   status: number | null,
 *   redirectLocation: string | null,
 *   error: string | null,
 *   notChecked: boolean,
 *   contentType: string | null,
 *   xRobotsTag: string[],
 *   bodyRead: 'html' | 'skipped-status' | 'skipped-not-html' | 'skipped-compressed' | null,
 *   truncated: boolean,
 *   metas: Array<{name: string, content: string}>,
 *   canonicals: string[],
 *   headComplete: boolean,
 * }} SampledPage      // status/redirectLocation/error/notChecked are exactly UrlCheck's fields
 *
 * @typedef {{
 *   sampleSize: number,        // resolved LHCI_SEO_SITEMAP_SAMPLE_SIZE
 *   eligibleCount: number,     // same-origin listed URLs the sample was drawn from
 *   skippedCrossOrigin: number,
 *   pages: SampledPage[],
 * }} UrlSample
 */
```

`SitemapDocumentsArtifact` gains `urlSample: UrlSample | null` (null when no sample was taken:
discovery `none`/`unavailable`, or no eligible URL). An artifact without the field is treated as "no
sample" by both audits (not-applicable), so older fixtures and artifacts do not crash them.

## Audits

### `sitemap-url-status` (existing, refactored; **behavior must not change**)

- Now a pure function of `artifacts.SitemapDocuments.urlSample`: no import of `safe-fetch.js`, no network.
- Must produce **the same result as today for the same sample**: same `score`, same table rows
  (`{url, result}` via the unchanged `describeCheck`), same `explanation` and `displayValue` text, same
  not-applicable conditions. Regression reference: `https://nodejs.org/en` (10 of ~1,731 sampled, 5 return
  404, score 0). Its test file is rewritten to feed artifacts instead of mocking `safeFetchStatus`, with the
  same cases.

### `sitemap-indexability` (new, scored binary)

- Judges only pages that returned a 2xx status (`status` 200-299). Others are `sitemap-url-status`'s
  finding. A judged page's noindex is evaluated from `xRobotsTag` and `metas`; its canonical from
  `canonicals`.
- **noindex fail**: `noindexFor` reports at least one of Googlebot/Bingbot blocked. Row:
  `{url, problem: "noindex for Googlebot and Bingbot (X-Robots-Tag header)"}` naming the crawlers and the
  source(s).
- **Canonical fail**: exactly one distinct canonical (after resolving a relative href against the page URL
  and dropping the fragment) that differs from the page URL by more than a trailing slash on the path.
  This includes a different query string, scheme, host (including `www`) or path. Row:
  `{url, problem: "canonical points to <resolved URL>"}`.
- **Note only, never fails**: canonical differs only by a trailing slash on the path; more than one
  distinct canonical on the page (conflicting; reported, not judged); a judged page whose
  `headComplete` is false (the `<head>` was not fully read, so an absent noindex is unproven); a 2xx page
  that is not HTML or was compressed (only its `X-Robots-Tag` header could be evaluated); counts of
  non-2xx pages left to `sitemap-url-status`.
- **Not applicable**: no `urlSample`, or no page in it returned 2xx.
- `score 0` if any noindex or canonical fail among judged pages; else `score 1` with `displayValue`
  "Checked N of M listed URLs (a sample)." plus the counts above. Rows capped at 20 with the true total in
  `explanation`.
- `DetailsType`: `table` (URL, Problem).
- **Stated limitation in the audit description**: it reads the raw HTML head of a plain request, so a
  noindex or canonical added by client-side JavaScript is not seen; and it is a sample, not proof for
  every listed URL.

## Category placement

- Category: existing `seo-extended` (this fork's own); weight 1 for `sitemap-indexability`;
  `sitemap-url-status` keeps its weight. No core category changes.

## Extension point

`packages/seo-audits/src/lighthouse-config.js` (via `.lighthouserc.js`'s `configPath`): add
`./audits/sitemap-indexability.js` to `audits` and one ref to `categories['seo-extended'].auditRefs`. No
artifact registration change (`SitemapDocuments` already registered). `package.json` gains
`"parse5": "^7.1.1"`.

## Risks / open questions

- **Regression of a merged audit** is the main risk: `sitemap-url-status` is moved from "audit fetches" to
  "gatherer fetches, audit reads". Protect with (1) its existing cases rewritten unchanged against
  artifacts, (2) a characterization test asserting the artifact-based path reproduces the old
  `checkUrls`-based output for the same inputs, and (3) a live before/after on nodejs.org (5 of 10 → 404).
- **False reassurance is the failure mode to design against**: every place the audit could miss a
  noindex (truncated head, compressed body, non-HTML, JavaScript-injected) must show up as a note or in
  the description, never as a silent pass.
- **Security**: the new capability reads up to 64 KiB of body from same-origin URLs. Bounds: same-origin
  only, sample of at most 25, 5 at once, 5 s total deadline each, 64 KiB per page, 30 s overall, no
  redirects, private-address policy and opt-in as everywhere. `/security-review` must exercise: an
  oversized/never-ending body, a slow-loris header, a response claiming `text/html` then streaming
  forever, `Content-Encoding: gzip` on an HTML URL, 65,000 bytes of deeply nested tags into `parse5`
  (timing), a `<meta name=robots>` hidden in a script string or comment, and a `Location` pointing at an
  internal address.
- **`parse5` performance on hostile input**: verify linear behavior on pathological nesting and
  misnested formatting elements within 64 KiB before trusting it; fall back to a depth-limited pre-scan
  only if a real problem is measured.
- **Gatherer runtime grows.** Sitemap documents can take up to ~105 s worst case (open low finding 3) and
  the sample adds up to ~30 s more. The developer plans to address the overall time budget after this item;
  it is not in this feature.
- **Artifact growth**: at most 25 pages with capped signals, negligible next to the sitemap locs.
- **Testing**: no test touches a live URL (repo convention): mock HTML fixtures for the extractor, injected
  fetchers for the gatherer, a local server with the permissive lookup for `safeFetchPrefix`, fixture
  artifacts for both audits.
