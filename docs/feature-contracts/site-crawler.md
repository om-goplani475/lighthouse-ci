# Feature contract: Site Crawler (core)

- slug: site-crawler

## TypeScript types

Plain ESM JS with JSDoc typedefs (see `lighthouse-conventions.md`), field-for-field the audit spec's snapshot. Pure types and
helpers live in `src/lib/crawl-snapshot.js`; the rest of the modules import them.

```js
// packages/seo-audits/src/lib/crawl-snapshot.js

/**
 * @typedef {{url: string, status: number, location: string | null}} CrawlHop
 * @typedef {{url: string, nofollow: boolean}} CrawlLink
 * @typedef {'ok' | 'skipped-not-html' | 'skipped-status' | 'error'} ExtractionState
 * @typedef {{
 *   url: string,                    // normalised seed URL that was requested first
 *   finalUrl: string,               // after same-origin redirects (equals url when none)
 *   redirects: CrawlHop[],          // each hop, in order; empty when none
 *   status: number | null,          // final response status; null when never answered
 *   contentType: string | null,
 *   bytes: number,                  // body bytes read (<= MAX_BODY_BYTES)
 *   truncated: boolean,             // the body cap was hit: text/links are partial
 *   title: string | null,           // <= MAX_TEXT_CHARS
 *   description: string | null,     // <= MAX_TEXT_CHARS
 *   canonicals: string[],           // <= 5, as written (not resolved)
 *   robotsMetas: Array<{name: string, content: string}>,   // robots / googlebot / bingbot, <= 20
 *   xRobotsTag: string[],           // <= 10 values, each <= MAX_TEXT_CHARS
 *   h1: string[],                   // <= 5, each <= 300 chars
 *   textHash: string | null,        // sha-256 hex of the normalised visible text; null when not extracted
 *   textLength: number,             // characters of normalised visible text
 *   wordCount: number,
 *   links: CrawlLink[],             // same-origin http(s), fragment dropped, deduplicated, <= MAX_LINKS_PER_PAGE
 *   source: 'audited' | 'link' | 'sitemap',
 *   extraction: ExtractionState,
 * }} CrawlPage
 *
 * @typedef {'blocked-by-robots' | 'cross-origin' | 'over-page-cap' | 'not-checked' | 'failed'} SkipReason
 * @typedef {{url: string, reason: SkipReason, detail: string | null}} CrawlSkip
 * @typedef {'present' | 'absent' | 'unavailable' | 'ignored'} CrawlRobotsState
 * @typedef {{
 *   version: 1,
 *   origin: string,
 *   createdAt: string,              // ISO 8601
 *   bounds: {pages: number, budgetMs: number, robots: 'honour' | 'ignore', userAgent: string},
 *   robots: {state: CrawlRobotsState},
 *   seeds: {audited: number, links: number, sitemap: number},
 *   pages: CrawlPage[],
 *   skipped: CrawlSkip[],
 *   stats: {requests: number, elapsedMs: number, truncatedByBudget: boolean},
 * }} CrawlSnapshot
 *
 * @typedef {{
 *   state: 'crawled' | 'cached' | 'disabled' | 'unavailable',
 *   auditedUrl: string,
 *   reason: string | null,          // set for disabled / unavailable
 *   snapshot: CrawlSnapshot | null, // null for disabled / unavailable
 *   auditedRenderedTextLength: number | null,  // Lighthouse's own rendered view, for shell-page detection
 * }} SiteCrawlArtifact
 */
```

```js
// Pure functions (no I/O, no import.meta, Jest-loadable):

// crawl-snapshot.js
//   normalizeUrl(href, base) -> string | null          lower-case scheme/host, default port dropped, fragment dropped,
//                                                       null for non-http(s) or unparseable; query kept as written
//   sameOrigin(a, b) -> boolean
//   selectSeeds({audited, links, sitemapUrls, pages}) -> Array<{url, source}>   audited first; links get
//                                                       ceil((pages-1)/2) slots, sitemap the rest, each via pickEvenly;
//                                                       a short list gives its slots away; deduplicated; <= pages
//   cacheKey({origin, pages, robots, userAgent}) -> string                       sha-256 hex
//   isSnapshot(value) -> value is CrawlSnapshot                                   structural + version check
//   CONSTANTS: SNAPSHOT_VERSION = 1, MAX_BODY_BYTES = 512 * 1024, MAX_TEXT_CHARS = 1_000, MAX_LINKS_PER_PAGE = 200,
//              MAX_H1 = 5, MAX_CANONICALS = 5, MAX_REDIRECT_ROUNDS = 3, REQUEST_CAP_FACTOR = 3,
//              USER_AGENT = 'lhci-seo-audits-crawler/1.0'

// crawl-extract.js
/**
 * @param {Buffer | string} body
 * @param {string} pageUrl    final URL of the page (links are resolved against it)
 * @param {{truncated: boolean}} options
 * @return {{
 *   title: string | null, description: string | null, canonicals: string[],
 *   robotsMetas: Array<{name: string, content: string}>, h1: string[],
 *   textHash: string, textLength: number, wordCount: number, links: CrawlLink[],
 * }}   never throws; hostile input yields empty fields
 */
// function extractPage(body, pageUrl, options)

// crawl-cache.js (fs; injectable `fs`/`os`/`now` for tests)
//   resolveCacheDir(env) -> string | null                 null when disabled (TTL 0)
//   readSnapshot(dir, key, {ttlMs, now}) -> CrawlSnapshot | null     null on missing/corrupt/old/expired/unsafe dir
//   writeSnapshot(dir, key, snapshot) -> boolean                      atomic (tmp + rename); false when the dir is unsafe
//   isSafeCacheDir(dir) -> boolean                         a real directory, owned by this user, no group/other access

// crawler.js (orchestration; every dependency injectable so tests never touch the network or disk)
/**
 * @param {{
 *   auditedUrl: string,
 *   pageLinks: string[],                 // internal links read from the live DOM
 *   env?: NodeJS.ProcessEnv,
 *   fetchPage?: typeof safeFetchPrefix,  // (url, {timeoutMs, maxBytes, userAgent}) -> PrefixResult
 *   fetchBytes?: typeof safeFetchBytes,  // robots.txt
 *   collectSitemap?: typeof collectSitemapDocuments,
 *   cache?: {read, write},
 *   now?: () => number,
 * }} input
 * @return {Promise<SiteCrawlArtifact>}   never throws
 */
// async function crawlSite(input)
```

```js
// packages/seo-audits/src/lib/safe-fetch.js: ADDITIVE option, no existing behaviour changes
//   safeFetchPrefix(url, {timeoutMs, maxBytes, userAgent})
//   `userAgent` (optional): printable ASCII, <= 200 chars, no CR/LF/NUL; anything else makes the call reject before any
//   connection. Sent as the User-Agent request header. Absent: no User-Agent header, exactly as today.
```

Audit result shape (`Audit.Product`) for `crawl-coverage`: `{score: 1, displayValue, details: table}` with
`scoreDisplayMode: informative`; `{score: 1, notApplicable: true, explanation}` when disabled, unavailable or missing.
Table columns: `url`, `status` (HTTP status or the skip reason), `title`, `words`, `source`; at most 100 rows plus an "N more
not shown" row; notes for budget / page cap / robots / server-HTML-only.

## `.lighthouserc.js` config additions

**None.** `configPath` only, same as every prior audit. Configuration is by environment variables (read per run, clamped, never
from the page, so a page cannot loosen a bound on requests to the audited site):

| Variable | Default | Clamp / values | Effect |
|---|---|---|---|
| `LHCI_SEO_CRAWL` | on | exactly `0` / `false` turns it off | gatherer returns a "disabled" artifact, no requests, audits not applicable |
| `LHCI_SEO_CRAWL_MAX_PAGES` | 50 | 1 to 200 | page cap (the audited page counts) |
| `LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS` | 120 | 10 to 600 | total crawl budget |
| `LHCI_SEO_CRAWL_RESPECT_ROBOTS` | on | exactly `0` / `false` turns it off | when off, robots-disallowed URLs are requested |
| `LHCI_SEO_CRAWL_CACHE_DIR` | `<tmp>/lhci-seo-crawl-<uid>` | a path | cache location (must pass the safe-directory check) |
| `LHCI_SEO_CRAWL_CACHE_TTL_SECONDS` | 600 | 0 to 86,400; 0 disables | cache freshness |

The body cap (512 KiB), link cap, concurrency (5), per-request timeout (5 s), redirect rounds (3) and user-agent are **constants**:
a knob that loosens a resource bound or the request identity is a security decision. A fresh install needs no new configuration;
`LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies to every request through the shared decision point.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a, not added to shared presets |
| lighthouse:all | n/a, not added to shared presets |
| (fork preset) | n/a, none exists; README guidance below |

Not added to `recommended.js`/`all.js` (opt-in via `configPath`; `packages/utils/test/presets.test.js` would fail otherwise).
`crawl-coverage` is **informational**: Lighthouse normalises its score to 1, so a `minScore` assertion on it always passes. The
README says to leave it out of `assertions`; there is nothing to gate on. (The Phase 7 audits that read the snapshot get their own
severities in their own contracts.)

## Public exports

New/modified files, all within `packages/seo-audits`:
- `src/lib/crawl-snapshot.js`, `src/lib/crawl-extract.js`, `src/lib/crawl-cache.js`, `src/lib/crawler.js`: new
- `src/gatherers/site-crawl.js`: new (reads the live DOM links and `finalDisplayedUrl`, calls `crawlSite`, pushes a run warning
  when the crawl could not run); exports the class and `skippedWarning`
- `src/audits/crawl-coverage.js`: new (thin; its table logic is in `crawl-snapshot.js` or a small `crawl-coverage.js` lib function
  so it is unit-tested)
- `src/lib/safe-fetch.js`: **modified**, additive `userAgent` option on `safeFetchPrefix` only
- `src/lighthouse-config.js`: registers the `SiteCrawl` artifact, the audit and its category ref
- `package.json`: adds `"htmlparser2": "^6.1.0"` (installed 6.1.0; the `htmlparser2@^6.1.0` range is already in `yarn.lock`, so no
  lockfile change; confirmed with `yarn install --frozen-lockfile` in the first task, and the task stops and reports if yarn wants
  to change the lockfile)
- tests under `test/lib/`, `test/gatherers/`, `test/audits/`, `test/lighthouse-config.test.js`
- `README.md`

`packages/cli` and `packages/utils` are not touched. The gatherer reuses `checkUrls`, `pickEvenly`, `safeFetchPrefix`,
`safeFetchBytes` and `collectSitemapDocuments` unchanged.

## Consistency check

Cross-checked against `docs/audit-specs/site-crawler.md` (completed, not provisional): the snapshot shape, the seed order and slot
formula, the constants (512 KiB, 5 canonicals, 200 links, 3 redirect rounds, request cap 3 x pages, 5 concurrent, 5 s), the
cache key, directory rules and atomic write, the six environment variables with their defaults and clamps, the user-agent, the
`htmlparser2` extraction decision (with its measurement) and the informational `crawl-coverage` audit all match. Two deliberate
additions to the audit spec, flagged for Gate 1: the artifact carries `auditedRenderedTextLength` (so Phase 7 audits can recognise a
script-rendered shell) and `SiteCrawlArtifact.state` distinguishes `crawled` from `cached`.
