# Feature contract: Sitemap Fetch and Parse

- slug: sitemap-fetch-and-parse

## TypeScript types

The package is plain ESM JS with JSDoc types (see `lighthouse-conventions.md`), so "types" are
`@typedef`s. Exact shapes, matching `docs/audit-specs/sitemap-fetch-and-parse.md`'s artifact block.

```js
// packages/seo-audits/src/lib/sitemap-parse.js (new) — exported typedefs, pure module, no I/O

/**
 * @typedef {{message: string, line: number, column: number}} SitemapParseError
 */
/**
 * @typedef {{value: string, reason: string}} InvalidLoc
 */
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
 *   kind: 'urlset' | 'sitemapindex' | 'invalid' | null,
 *   namespaceOk: boolean,
 *   parseError: SitemapParseError | null,
 *   locs: string[],
 *   entryCount: number,
 *   entriesTruncated: boolean,
 *   invalidLocs: InvalidLoc[],
 *   invalidLocCount: number,
 * }} SitemapDocument
 */
/**
 * @typedef {{
 *   discovery: 'robots-txt' | 'default-location' | 'none' | 'unavailable',
 *   ignoredSitemapLines: string[],
 *   documentsTruncated: boolean,
 *   documents: SitemapDocument[],
 * }} SitemapDocumentsArtifact
 */
```

```js
// packages/seo-audits/src/lib/sitemap-parse.js — limits, module constants (not user-configurable in v1)

const LIMITS = {
  MAX_DECLARED: 5,
  MAX_DOCUMENTS: 10,
  MAX_COMPRESSED_BYTES: 52_428_801,   // wire cap == decompressed cap; see "Implementation deviations"
  MAX_UNCOMPRESSED_BYTES: 52_428_801, // 50 MiB + 1, so "over the limit" is detectable
  MAX_ENTRIES_STORED: 50_001,         // 50,000 protocol limit + 1
  MAX_LOC_LENGTH: 2048,
  MAX_INVALID_LOC_EXAMPLES: 20,
  REQUEST_TIMEOUT_MS: 10_000,
};

/**
 * Pure: bytes in, SitemapDocument out. Handles gzip (magic bytes, not just the URL), capped
 * decompression, saxes parsing, loc validation. Never throws for bad input — returns an
 * `outcome: 'decompression-error'` / `parseError` document instead.
 * @param {{url: string, source: SitemapDocument['source'], parentUrl: string | null,
 *          status: number, body: Buffer}} input
 * @return {SitemapDocument}
 */
// function parseSitemapBytes(input)
```

```js
// packages/seo-audits/src/lib/safe-fetch.js — ADDITIVE export

/**
 * Same URL/scheme/literal-IP/safeLookup/no-redirect protections as safeFetchJson. Non-2xx statuses
 * are returned (not thrown). Rejects when the body exceeds `maxBytes` or on timeout/network error.
 * @param {string} urlString
 * @param {{timeoutMs?: number, maxBytes?: number}} [options]
 * @return {Promise<{status: number, redirectLocation: string | null, body: Buffer}>}
 */
// function safeFetchBytes(urlString, options)
// function fetchBytesWithLookup(urlString, lookup, options)  // exported for tests only, like its siblings
```

```js
// packages/seo-audits/src/gatherers/sitemap-documents.js — gatherer

/**
 * Orchestration only: discovery, bounded breadth-first fetch loop, index one-level follow.
 * `fetchBytes` is injectable (default `safeFetchBytes`) so tests never touch the network.
 * @param {{finalDisplayedUrl: string}} url
 * @param {{fetchBytes?: typeof safeFetchBytes}} [deps]
 * @return {Promise<SitemapDocumentsArtifact>}
 */
// async function collectSitemapDocuments(url, deps)
```

Audit-local row shapes (report tables), one per audit:

```js
/** sitemap-valid           */ // {url: string, problem: string, detail: string}
/** sitemap-duplicate-urls  */ // {sitemap: string, url: string, count: number}
/** sitemap-limits          */ // {url: string, type: string, entries: string, size: string, gzip: string, limit: string}
```

## `.lighthouserc.js` config additions

**None.** Same as every prior audit: rides the existing `configPath` mechanism. The caps are module
constants, deliberately not exposed as config in v1 (a knob that weakens a resource/SSRF bound is a
security decision, not a preference; revisit only if a real need appears). A fresh install needs no
new config for sensible behavior.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a — not added to shared presets |
| lighthouse:all | n/a — not added to shared presets |
| (fork preset) | n/a — none exists; README guidance below |

Not added to `recommended.js`/`all.js` (opt-in via `configPath`; `packages/utils/test/presets.test.js`
would fail otherwise), same as every prior audit.

All three audits are **scored binary** (`score` 0/1), so `minScore` assertions work normally in
`lhci assert` (unlike the informative audits, whose LHR score is normalized to 1). README guidance,
deliberately different per audit rather than one blanket value:

| Audit | Suggested severity | Why |
|---|---|---|
| `sitemap-valid` | `error` | A malformed/unreachable/redirecting sitemap is a definite defect; clear pass/fail, low false-positive risk. The one softness: a *redirecting* declared URL is flagged although Google follows redirects, so consumers with that pattern may prefer `warn`. |
| `sitemap-limits` | `error` | Google documents 50,000 URLs / 50 MB uncompressed as hard limits it enforces; over-limit content is ignored. |
| `sitemap-duplicate-urls` | `warn` | Duplicates waste crawl budget and hint at generation bugs, but search engines tolerate them; exact-string matching is also deliberately conservative. |

Example (README): `'sitemap-valid': ['error', {minScore: 1}]`, `'sitemap-limits': ['error', {minScore:
1}]`, `'sitemap-duplicate-urls': ['warn', {minScore: 1}]`.

## Public exports

New/modified files, all within `packages/seo-audits`:
- `src/gatherers/sitemap-documents.js` (new gatherer, default export; also exports
  `collectSitemapDocuments` for tests)
- `src/lib/sitemap-parse.js` (new, pure)
- `src/lib/safe-fetch.js` (**modified**, additive `safeFetchBytes` + `fetchBytesWithLookup`; no
  change to any existing export's behavior or signature)
- `src/audits/sitemap-valid.js`, `src/audits/sitemap-duplicate-urls.js`, `src/audits/sitemap-limits.js` (new)
- `src/lighthouse-config.js` — registers the artifact, three audits, three category refs
- `package.json` — adds `"saxes": "^6.0.0"` (installed 6.0.0, ships its own types; the
  `saxes@^6.0.0` range is already in `yarn.lock`, so no lockfile change)
- tests under `test/lib/`, `test/gatherers/`, `test/audits/`, `test/lighthouse-config.test.js`
- `README.md` — documents the three audits, the caps, the redirect/cross-origin behavior, and the
  severity table above

`packages/cli` still never imports `@lhci/seo-audits` directly (unchanged pattern).

## Consistency check

Cross-checked against `docs/audit-specs/sitemap-fetch-and-parse.md` (completed, not provisional):

- `SitemapDocument`/`SitemapDocumentsArtifact` are field-for-field the audit spec's artifact block.
- `LIMITS` values equal the audit spec's caps (5 declared, 10 documents, 15 MiB compressed, 50 MiB+1
  decompressed, 50,001 stored entries, 2,048-char loc, 20 invalid examples, 10 s timeout).
- `safeFetchBytes` returns non-2xx rather than throwing because the audit spec needs the status
  recorded as `outcome: 'http-error'`/`'redirect'`; the discovery rule (404/410 on the probe means
  `'none'`, other statuses/network errors mean `'unavailable'`) lives in the gatherer, not the fetcher.
- Decisions carried through: cross-origin fetched, redirects reported not followed, exact-string
  duplicates per document, all three audits binary-scored and `notApplicable` on
  `discovery: 'none' | 'unavailable'`.
- One import-time constraint to preserve: none of these files touch `import.meta` or
  `rule-engine/registry.js`, so all of them (lib, gatherer, audits) load directly under Jest with no
  shell-out workaround. The gatherer extends `BaseGatherer` (`lighthouse/core/gather/base-gatherer.js`),
  which `favicon-links.js` already does under Jest.

## Implementation deviations (recorded at /implement, 2026-09-30)

Two deliberate differences from the text above, both found while implementing:

1. **`MAX_COMPRESSED_BYTES` is 50 MiB + 1, not 15 MiB.** A plain (non-gzip) sitemap is legitimately
   up to 50 MiB on the wire, so a 15 MiB wire cap would report a valid 20-50 MiB sitemap as a fetch
   failure, exactly the size range `sitemap-limits` must judge. Memory and time stay bounded by
   this cap, the 50 MiB + 1 decompressed cap, and the fetcher's 10 s total deadline.
2. **`entryCount` counts every `<loc>` seen, valid or not**, so `locs.length + invalidLocCount ===
   entryCount` (`locs` holds only valid values), rather than `entryCount === locs.length`. This keeps
   the 50,000-entry limit honest for a file full of invalid locs.

Also: `safeFetchBytes`' `timeoutMs` is a *total* wall-clock deadline (a trickling server would
never trip a socket idle timeout), and `parseSitemapBytes` takes an optional second argument
`{maxUncompressedBytes}` used only by tests to avoid allocating 50 MiB.
