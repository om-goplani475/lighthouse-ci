# Feature contract: Sitemap vs Indexability

- slug: sitemap-indexability

## TypeScript types

Plain ESM JS with JSDoc typedefs (see `lighthouse-conventions.md`). Field-for-field the audit spec's
shapes.

```js
// packages/seo-audits/src/lib/sitemap-parse.js — typedef additions (existing typedefs unchanged)

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
 * }} SampledPage
 *
 * @typedef {{
 *   sampleSize: number,
 *   eligibleCount: number,
 *   skippedCrossOrigin: number,
 *   pages: SampledPage[],
 * }} UrlSample
 */
// SitemapDocumentsArtifact gains one field:
//   urlSample: UrlSample | null      // null: no sample taken. Absent (older artifact): treated as null.
```

```js
// packages/seo-audits/src/lib/safe-fetch.js — ADDITIVE exports

/**
 * Same protections as safeFetchBytes (scheme allowlist, isBlockedAddress for literal and resolved
 * addresses, no redirects, total deadline). Reads at most `maxBytes` of a 2xx HTML body with
 * `Accept-Encoding: identity`; otherwise destroys the response and reports why the body was skipped.
 * Stopping at the byte cap RESOLVES with truncated: true (it is not an error); a failure before
 * headers rejects.
 * @param {string} urlString
 * @param {{timeoutMs?: number, maxBytes?: number}} [options]   defaults 5000 ms, 64 * 1024 bytes
 * @return {Promise<{
 *   status: number,
 *   redirectLocation: string | null,
 *   headers: {'x-robots-tag': string[], 'content-type': string[], 'content-encoding': string[], location: string[]},
 *   body: Buffer,
 *   bodyRead: 'html' | 'skipped-status' | 'skipped-not-html' | 'skipped-compressed',
 *   truncated: boolean,
 * }>}
 */
// function safeFetchPrefix(urlString, options)
// function fetchPrefixWithLookup(urlString, lookup, options)   // exported for tests only
```

```js
// packages/seo-audits/src/lib/html-head-signals.js (new, pure, no I/O)

/**
 * @param {Buffer | string} body   a prefix of an HTML document
 * @param {{truncated: boolean}} options
 * @return {{
 *   metas: Array<{name: string, content: string}>,   // names robots|googlebot|bingbot; <=20; content <=1000 chars
 *   canonicals: string[],                            // raw hrefs of rel~=canonical links; <=5; empty dropped
 *   headComplete: boolean,
 * }}
 */
// function extractHeadSignals(body, options)     // never throws
```

```js
// packages/seo-audits/src/lib/robots-directives.js — ADDITIVE export; no existing export changes

/**
 * @param {Array<'googlebot' | 'bingbot'>} crawlers
 * @param {{metas: Array<{name: string, content: string}>, xRobotsTag: string[]}} signals
 * @return {Array<{crawler: 'googlebot' | 'bingbot', via: string[]}>}   only crawlers that are blocked
 */
// function noindexFor(crawlers, signals)
```

```js
// packages/seo-audits/src/lib/sitemap-url-sample.js — generalization only

// checkUrls(urls, {fetchStatus, ...}) keeps its signature and behavior. `fetchStatus` may now resolve
// an object with extra fields; checkOne returns them under `response` (raw, opaque to checkUrls) in
// addition to the existing status/redirectLocation/error/notChecked, so the gatherer can pass
// safeFetchPrefix results through and derive SampledPage from them.
//
// New, used by the gatherer only:
/**
 * @param {SitemapDocument[]} documents
 * @param {{fetchPage?: typeof safeFetchPrefix, env?: NodeJS.ProcessEnv, now?: () => number}} [deps]
 * @return {Promise<UrlSample | null>}
 */
// async function collectUrlSample(documents, deps)
```

```js
// packages/seo-audits/src/audits/sitemap-indexability.js — audit-local report row shape
/** {url: string, problem: string} */
```

## `.lighthouserc.js` config additions

**None.** Same as every prior audit: `configPath` only. The sample size is the existing environment
variable **`LHCI_SEO_SITEMAP_SAMPLE_SIZE`** (default 10, clamped 1-25), now read by the gatherer, with the
same meaning; the private-network opt-in `LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies to the new fetch through
the shared decision point. The 64 KiB body cap, 5 s deadline and concurrency are constants (a knob that
loosens a resource bound is a security decision). A fresh install needs no new configuration.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a, not added to shared presets |
| lighthouse:all | n/a, not added to shared presets |
| (fork preset) | n/a, none exists; README guidance below |

Not added to `recommended.js`/`all.js` (opt-in via `configPath`; `packages/utils/test/presets.test.js`
would fail otherwise), like every prior audit. Both audits are **scored binary**, so `minScore`
assertions work in `lhci assert`.

Suggested severities, deliberately different, stated in the README:

| Audit | Suggested | Why |
|---|---|---|
| `sitemap-indexability` | `warn` | A listed noindex page is a definite contradiction, but the audit also fails a canonical that points elsewhere, and a sitemap can legitimately list a variant; it is a sample, and it reads only the raw HTML head (JavaScript-injected tags are invisible). Move to `error` once you have confirmed your sitemap is clean. |
| `sitemap-url-status` | `warn` (unchanged) | Sample-based; a network blip can fail a URL. |

Example: `'sitemap-indexability': ['warn', {minScore: 1}]`.

## Public exports

New/modified files, all within `packages/seo-audits`:
- `src/gatherers/sitemap-documents.js`: **modified** (collects `urlSample` after the documents; the class
  and registration are unchanged)
- `src/lib/safe-fetch.js`: **modified**, additive `safeFetchPrefix` + `fetchPrefixWithLookup`; no existing
  export's behavior or signature changes
- `src/lib/html-head-signals.js`: new
- `src/lib/robots-directives.js`: **modified**, additive `noindexFor`
- `src/lib/sitemap-url-sample.js`: **modified**, `checkUrls` passes extra fetcher fields through;
  `collectUrlSample` added
- `src/lib/sitemap-parse.js`: **modified**, typedefs only
- `src/audits/sitemap-url-status.js`: **modified** (refactored to read the artifact; output unchanged)
- `src/audits/sitemap-indexability.js`: new
- `src/lighthouse-config.js`: registers the new audit and its category ref
- `package.json`: adds `"parse5": "^7.1.1"` (installed 7.1.2, ships types; the `parse5@^7.1.1` range is
  already in `yarn.lock`, so no lockfile change)
- tests under `test/lib/`, `test/gatherers/`, `test/audits/`, `test/lighthouse-config.test.js`
- `README.md`

`packages/cli` still never imports `@lhci/seo-audits` directly (unchanged pattern).

## Consistency check

Cross-checked against `docs/audit-specs/sitemap-indexability.md` (completed, not provisional):

- `SampledPage`/`UrlSample` are the audit spec's artifact block field-for-field, and `SampledPage`
  contains exactly `UrlCheck`'s four fields, which is what lets `sitemap-url-status` reuse
  `describeCheck` unchanged and keep its output identical.
- `safeFetchPrefix`'s header allowlist, `bodyRead` values, "resolve on the cap, reject before headers" and
  defaults (5000 ms, 64 KiB) match the spec; the `identity` request header and the read-only-2xx-HTML rule
  are in the docs above and are behaviors the implementation and its tests must pin.
- `extractHeadSignals`' caps (20 metas, 5 canonicals, 1,000-character content), the three meta names, the
  scripting-enabled tree, "head children only" and the `headComplete` rule match the spec.
- `noindexFor` matches the spec's grammar (known-directive keys decide unscoped vs user-agent-scoped;
  scope recognized only at the start of a header value; only `googlebot`/`bingbot` scopes count) and is
  additive: `parseDirectives`, `blocksIndexing`, `buildReportResult` and `buildConflictResult` are untouched,
  so the two `robots-directives-*` audits cannot change.
- Decisions carried through: sampling lives in `SitemapDocuments`; `parse5` is the parser; noindex is
  Googlebot/Bingbot-aware; canonical elsewhere fails except trailing-slash-only; blocked-by-robots.txt is not
  repeated; both audits are binary-scored and not-applicable without a usable sample.
- **Import-time constraint**: none of the new or modified files touch `import.meta` or
  `rule-engine/registry.js`, so all load directly under Jest with no shell-out. `parse5` is dual CJS/ESM;
  the Jest CommonJS path uses its `dist/cjs` entry, to be confirmed by the first test that imports it (a
  first-task check, not an assumption).
- Known follow-ups not in this contract: the gatherer's overall time budget (open low security finding)
  and the stale finding statuses, both to be handled after this item, as the developer asked.
