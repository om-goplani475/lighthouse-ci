# Task sequence: Sitemap Fetch and Parse

- slug: sitemap-fetch-and-parse

Branching: `feat/sitemap-fetch-and-parse` off `phase-4-robots-sitemap`; Gate 3's merge target is the
phase branch (per `AGENTS.md`'s "Phase branches"). Every task's `scope_whitelist` is inside
`packages/seo-audits`, so none is flagged higher-risk; nothing touches `packages/utils` or
`packages/cli`. Each task includes its own tests so every commit leaves the suite green (the
"implementation before its fixture test" rule is met inside each commit, not by a trailing test-only
commit).

Security note for the implementer: tasks 02 and 06 are the ones that add outbound-fetch behavior.
Both must follow `.ai-agents/prompts/security-checklist.md`, and neither may add any way for a caller
to weaken `safeLookup`.

## Tasks

### task-01: Declare the `saxes` dependency

- scope_whitelist: [packages/seo-audits/package.json]
- depends_on: none
- description: Add `"saxes": "^6.0.0"` to `dependencies` (alphabetical). Confirm the installed
  6.0.0 satisfies it and that `yarn.lock` already contains the `saxes@^6.0.0` entry, so no lockfile
  change is expected; if yarn does want to change the lockfile, stop and report rather than commit it.
- commit_message: "chore(seo-audits): declare saxes dependency for sitemap parsing"

### task-02: `safeFetchBytes` in safe-fetch

- scope_whitelist: [packages/seo-audits/src/lib/safe-fetch.js, packages/seo-audits/test/lib/safe-fetch.test.js]
- depends_on: none
- description: Add `fetchBytesWithLookup(url, lookup, {timeoutMs, maxBytes})` and the public
  `safeFetchBytes(url, options)` per the contract: same URL/scheme validation, literal-IP check,
  `safeLookup`, and no-redirect policy as `safeFetchJson`; resolves `{status, redirectLocation, body}`
  and **returns** non-2xx statuses (including 3xx with the `Location` header) instead of throwing;
  rejects on timeout, network error, or body exceeding `maxBytes` (destroying the request). Defaults:
  `timeoutMs` 10,000, `maxBytes` 15 MiB. Additive only: no existing export's behavior or signature
  changes. Tests use the existing local-server + permissive-lookup technique: 200 body bytes intact
  (including binary/gzip bytes), 404 returned, 301 returned with `redirectLocation` and not followed,
  over-`maxBytes` rejection, timeout, private literal IP rejected, non-http scheme rejected.
- commit_message: "feat(seo-audits): add safeFetchBytes to safe-fetch"

### task-03: Sitemap XML parse core (uncompressed)

- scope_whitelist: [packages/seo-audits/src/lib/sitemap-parse.js, packages/seo-audits/test/lib/sitemap-parse.test.js]
- depends_on: task-01
- description: New pure module. Exports the `SitemapDocument`/`SitemapDocumentsArtifact`/`LIMITS`
  contract typedefs/constants and `parseSitemapBytes({url, source, parentUrl, status, body})` for
  **plain (non-gzip) XML only** in this task. Strict `saxes` with `xmlns: true`; classifies
  `urlset`/`sitemapindex`/`invalid`; checks the root namespace is
  `http://www.sitemaps.org/schemas/sitemap/0.9`; collects `<loc>` text of `<url>`/`<sitemap>`
  children only (extension namespaces tolerated and ignored); validates each loc (non-empty,
  absolute http(s), ≤ 2,048 chars) into `invalidLocs` (capped 20, true count in `invalidLocCount`);
  stops after `MAX_ENTRIES_STORED` locs with `entriesTruncated`; records the first parse error with
  line/column and stops consuming. Never throws on bad input. Tests: valid urlset, valid index,
  wrong root element, missing/wrong namespace, unclosed tag (line/column), empty body, non-XML text,
  image/video/news/xhtml extension elements, invalid-loc variants and cap, entry cap, whitespace
  trimming in `<loc>`, CDATA loc, XML entity in loc.
- commit_message: "feat(seo-audits): add sitemap XML parse core"

### task-04: Gzip handling and decompressed-size cap

- scope_whitelist: [packages/seo-audits/src/lib/sitemap-parse.js, packages/seo-audits/test/lib/sitemap-parse.test.js]
- depends_on: task-03
- description: Extend `parseSitemapBytes` to detect gzip by magic bytes (`1f 8b`), not only by URL
  suffix, and gunzip with a hard cap of `MAX_UNCOMPRESSED_BYTES` on *output*: streaming decompression
  that stops at the cap, sets `exceededUncompressedLimit` and `uncompressedBytes` (at least the cap),
  and destroys the stream rather than inflating further (gzip-bomb protection); a corrupt/truncated
  gzip stream yields `outcome: 'decompression-error'` with a message. The stored `compressedBytes`
  is the body length. Test the cap with a small injected `maxUncompressedBytes` override on an
  internal function (not a public knob) plus a highly compressible payload, so the test does not
  allocate 50 MiB.
- commit_message: "feat(seo-audits): add gzip support to sitemap parse core"

### task-05: `SitemapDocuments` gatherer: discovery and root documents

- scope_whitelist: [packages/seo-audits/src/gatherers/sitemap-documents.js, packages/seo-audits/test/gatherers/sitemap-documents.test.js]
- depends_on: task-02, task-04
- description: New gatherer class (`BaseGatherer`, `supportedModes: ['navigation','snapshot']`,
  same `@ts-expect-error` boundary comment as `favicon-links.js`) plus exported
  `collectSitemapDocuments(url, {fetchBytes})` with an injectable fetcher (default `safeFetchBytes`).
  Implements the audit spec's discovery: fetch `/robots.txt` (5 s timeout, 1 MiB cap); take
  `Sitemap:` values via `parseRobotsTxt`, keep absolute http(s) only (others into
  `ignoredSitemapLines`), dedupe, cap at `MAX_DECLARED`; else probe `/sitemap.xml` (200 →
  `default-location`, 404/410 → `none`, anything else → `unavailable`); robots.txt 5xx/network error
  → `unavailable`. Fetch each root document once, parse via `parseSitemapBytes`, and record HTTP
  errors, redirects (with `Location`) and network errors as `outcome` data, never as a thrown error.
  Index following is task-06; this task treats an index as an ordinary document. Tests with an
  injected fetcher: declared, cross-origin declared, relative line ignored, fallback 200/404/500,
  robots 404 vs 503, declared 404, declared redirect, network error, dedupe, `MAX_DECLARED`.
- commit_message: "feat(seo-audits): add SitemapDocuments gatherer with discovery"

### task-06: Sitemap index following and document cap

- scope_whitelist: [packages/seo-audits/src/gatherers/sitemap-documents.js, packages/seo-audits/test/gatherers/sitemap-documents.test.js]
- depends_on: task-05
- description: Follow a `sitemapindex` one level: fetch its child `<loc>`s breadth-first as
  `source: 'index-child'` with `parentUrl`, respecting the total `MAX_DOCUMENTS` (roots first). A
  child that is itself an index is recorded but its children are not fetched. Reaching the cap sets
  `documentsTruncated: true`. Child fetch failures are recorded per document like any other, never
  aborting the run. Only children that passed loc validation are fetched (an invalid loc is not
  requested). Tests: index with children, child 404, nested index not followed, over-cap truncation
  flag, root-plus-children cap accounting, invalid child loc never fetched (asserts the injected
  fetcher's call list).
- commit_message: "feat(seo-audits): follow sitemap indexes one level in SitemapDocuments"

### task-07: Gatherer integration test against a local server

- scope_whitelist: [packages/seo-audits/test/gatherers/sitemap-documents.integration.test.js]
- depends_on: task-06
- description: Runs `collectSitemapDocuments` with a real local HTTP server and
  `fetchBytesWithLookup` bound to the permissive test-only lookup (never `safeLookup`, never a live
  URL). Covers what the injected-fetcher tests cannot: real gzip bytes over the wire, a real 301, a
  real slow response hitting the timeout, and an over-cap body. This is also the failure-path
  driver referenced by the audit spec's testing note, since `lhci collect` against localhost cannot
  reach a local sitemap by design. Test-only; no source changes.
- commit_message: "test(seo-audits): add SitemapDocuments local-server integration test"

### task-08: `sitemap-valid` audit

- scope_whitelist: [packages/seo-audits/src/audits/sitemap-valid.js, packages/seo-audits/test/audits/sitemap-valid.test.js]
- depends_on: task-03
- description: Audit per the audit spec (`requiredArtifacts: ['SitemapDocuments']`, same
  `@ts-expect-error` boundary comments as `manifest-icons.js`). `notApplicable` when `discovery` is
  `none`/`unavailable`; score 0 with a `table` (Sitemap URL, Problem, Detail) for HTTP error,
  redirect ("declare the final URL"), network error, gunzip error, parse error with line/column,
  wrong root/namespace, invalid locs; ignored robots.txt lines reported without failing. Pure
  function of the artifact, so tests use fixture artifacts.
- commit_message: "feat(seo-audits): add sitemap-valid audit"

### task-09: `sitemap-duplicate-urls` audit

- scope_whitelist: [packages/seo-audits/src/audits/sitemap-duplicate-urls.js, packages/seo-audits/test/audits/sitemap-duplicate-urls.test.js]
- depends_on: task-03
- description: Per the audit spec: exact-string (trimmed) duplicates within a single `urlset`
  document, table (Sitemap, URL, Times listed) capped at 20 rows with the true total in the
  explanation; documents that are not `ok`/`urlset` skipped; a truncated document noted as partial;
  cross-document duplicates not flagged; `notApplicable` on `none`/`unavailable`, and also when no
  document is a checkable `urlset`. Tests cover each, including that `/a` vs `/a/` and different
  case are *not* duplicates.
- commit_message: "feat(seo-audits): add sitemap-duplicate-urls audit"

### task-10: `sitemap-limits` audit

- scope_whitelist: [packages/seo-audits/src/audits/sitemap-limits.js, packages/seo-audits/test/audits/sitemap-limits.test.js]
- depends_on: task-03
- description: Per the audit spec: fail when a document has more than 50,000 entries
  (urlset URLs or index children) or `exceededUncompressedLimit`; informational table row for every
  document (type, entries, size or "over 50 MiB", gzip, limit status); explanation states
  when only a subset was checked (`documentsTruncated`, `entriesTruncated`) and never presents
  unchecked documents as passing; `notApplicable` on `none`/`unavailable`. Tests use fixture
  artifacts, including exactly 50,000 (passes) vs 50,001 entries (fails).
- commit_message: "feat(seo-audits): add sitemap-limits audit"

### task-11: Register the gatherer and audits in the Lighthouse config

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-05, task-08, task-09, task-10
- description: Add `{id: 'SitemapDocuments', gatherer: './gatherers/sitemap-documents.js'}` to
  `artifacts`, the three audit paths to `audits`, and three weight-1 refs to
  `categories['seo-extended'].auditRefs`; update the file's header comment. Update the regression
  test's expected audit list and count (24 → 27) and confirm `extends: 'lighthouse:default'`
  behavior is unchanged.
- commit_message: "feat(seo-audits): register SitemapDocuments and sitemap audits in config"

### task-12: README update

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-11
- description: Document the three audits and the gatherer: discovery order (robots.txt then
  `/sitemap.xml`), the caps, cross-origin sitemaps fetched, redirects reported not followed, the
  exact-string duplicate rule, the not-applicable conditions, and the contract's per-audit severity
  table with example `.lighthouserc.js` assertions. State the localhost limitation (private/loopback
  addresses are blocked by design, so local pages can't be used to test sitemap audits).
- commit_message: "docs(seo-audits): document sitemap audits and their fetch limits"
