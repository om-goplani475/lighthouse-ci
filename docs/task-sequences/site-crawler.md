# Task sequence: Site Crawler (core)

- slug: site-crawler

Branching: `feat/site-crawler` off `phase-7-duplicates`; Gate 3's merge target is the phase branch (per `AGENTS.md`'s "Phase
branches"). Every task's `scope_whitelist` is inside `packages/seo-audits`, so none is flagged higher-risk; nothing touches
`packages/utils` or `packages/cli`. Each task carries its own tests so every commit leaves the suite green.

Three things to watch while implementing:

- **Task 4 modifies a merged, security-critical file** (`safe-fetch.js`), additively and only `safeFetchPrefix`. Every existing
  safe-fetch test must pass unmodified; the new option may not change behaviour when absent, and a bad value must reject before
  any connection is made.
- **Tasks 3 and 5 are the attack-surface tasks** (parsing attacker-influenced HTML at 512 KiB; a cache directory on a shared
  machine). Both need adversarial tests, and both follow `.ai-agents/prompts/security-checklist.md`. Timing assertions use a
  generous margin (the measured worst case for extraction is 53 ms; assert under 2 s) so they guard the bound without flaking.
- **Task 6 must never throw and never request another origin**: every failure is data in the artifact, and the tests assert the
  exact list of requested URLs.

## Tasks

### task-01: Declare the htmlparser2 dependency

- scope_whitelist: [packages/seo-audits/package.json]
- depends_on: none
- description: Add `"htmlparser2": "^6.1.0"` to `dependencies` (alphabetical). Confirm the installed 6.1.0 satisfies it and that
  `yarn install --frozen-lockfile` still passes because `yarn.lock` already has the `htmlparser2@^6.1.0` range; if yarn wants to
  change the lockfile, stop and report instead of committing it. Confirm `require('htmlparser2')` loads under Jest's CommonJS
  transform and in real Node ESM (`import {Parser} from 'htmlparser2'`); if either fails, stop and report.
- commit_message: "chore(seo-audits): declare htmlparser2 dependency for crawler extraction"

### task-02: Crawl snapshot types and helpers

- scope_whitelist: [packages/seo-audits/src/lib/crawl-snapshot.js, packages/seo-audits/test/lib/crawl-snapshot.test.js]
- depends_on: task-01
- description: New pure module per the contract: the typedefs, the constants (`SNAPSHOT_VERSION`, `MAX_BODY_BYTES`,
  `MAX_TEXT_CHARS`, `MAX_LINKS_PER_PAGE`, `MAX_H1`, `MAX_CANONICALS`, `MAX_REDIRECT_ROUNDS`, `REQUEST_CAP_FACTOR`, `USER_AGENT`),
  `normalizeUrl`, `sameOrigin`, `selectSeeds`, `cacheKey`, `isSnapshot`. Tests: normalisation (case, default ports, fragment,
  relative against a base, non-http(s), unparseable, query kept, IPv6), `sameOrigin` for host/port/scheme differences and lookalike
  hosts, seed selection (audited first, slot split for odd and even page counts, a short list giving its slots away, deduplication,
  cross-origin dropped by the caller not here, determinism, the cap), `cacheKey` differs for each bound and is stable, `isSnapshot`
  accepts a valid snapshot and rejects wrong version, missing fields, wrong types, `null`, and an array.
- commit_message: "feat(seo-audits): add crawl snapshot types and helpers"

### task-03: Page extraction with htmlparser2

- scope_whitelist: [packages/seo-audits/src/lib/crawl-extract.js, packages/seo-audits/test/lib/crawl-extract.test.js]
- depends_on: task-02
- description: New pure module `extractPage(body, pageUrl, {truncated})` per the audit spec's "Extraction": `htmlparser2.Parser`
  callbacks only, a skip-stack for `script`, `style`, `noscript`, `template`, `head` (text) and `hidden` elements, head fields,
  `<h1>`, links (resolved against the page URL, same origin only, fragment dropped, `nofollow` noted, deduplicated, capped), the
  normalised visible text hashed with sha-256, `textLength`, `wordCount`. Never throws. Tests: title/description/canonical/robots
  metas read once and capped; text inside script/style/noscript/template/head/hidden excluded; whitespace collapsed and
  lower-cased; entities decoded; the same text in different markup hashes equal and different text differs; `<meta>` inside a script
  string or comment is not read; relative/absolute/protocol-relative/`mailto:`/`javascript:` links; cross-origin links dropped;
  `nofollow` detection; link cap and h1 cap; Buffer and string input; invalid UTF-8; empty input; and **adversarial input at the
  512 KiB cap** (the measured shapes: nested `<div>`, nested `<ul><li>`, misnested `<b><i>`, nested tables, unclosed `<a>`, 100k
  links, 170k `<p>`, an entity run, a comment flood, huge attributes, a `<script>` full of `<`), each extracted in under 2 s.
- commit_message: "feat(seo-audits): add crawler page extraction with htmlparser2"

### task-04: User-agent option on safeFetchPrefix

- scope_whitelist: [packages/seo-audits/src/lib/safe-fetch.js, packages/seo-audits/test/lib/safe-fetch.test.js]
- depends_on: none
- description: Additive only. `safeFetchPrefix(url, {timeoutMs, maxBytes, userAgent})`: when `userAgent` is given it must be a string
  of printable ASCII (0x20 to 0x7e), at most 200 characters; anything else (control characters, CR/LF, NUL, non-ASCII, empty,
  too long, non-string) makes the call **reject before any connection or DNS lookup**. A valid value is sent as the `User-Agent`
  header. Absent: the request is byte-for-byte what it is today (no `User-Agent`). Every existing safe-fetch test must pass
  unmodified. Tests: header is sent when valid (against a real local server with the permissive test lookup the file already
  uses); each invalid class rejects and no connection is opened (the server records zero requests); absent sends no header;
  the other fetch functions are unchanged.
- commit_message: "feat(seo-audits): add a validated userAgent option to safeFetchPrefix"

### task-05: Crawl snapshot cache

- scope_whitelist: [packages/seo-audits/src/lib/crawl-cache.js, packages/seo-audits/test/lib/crawl-cache.test.js]
- depends_on: task-02
- description: New module per the contract: `resolveCacheDir`, `isSafeCacheDir`, `readSnapshot`, `writeSnapshot`. The default
  directory is `<os.tmpdir()>/lhci-seo-crawl-<uid>` created `0o700`; it is used only if it is a real directory (not a symlink),
  owned by the current user, with no group/other access. Writes are atomic (`<name>.<pid>.tmp` then rename). A missing, corrupt
  (not JSON, wrong shape, wrong version), old or expired file reads as `null`. TTL 0 disables. Tests against real temporary
  directories: write then read; expired by the injected clock; corrupt JSON; a file that is valid JSON but not a snapshot;
  wrong version; a symlinked cache directory is refused; a directory with group or other write/read bits is refused; a directory
  owned by someone else is refused where the platform allows testing it (skipped, not faked, otherwise); concurrent writers never
  leave a half-written file; the temp file is not left behind; the key is used as a hex file name only (a hostile key cannot
  escape the directory); TTL 0 returns no directory.
- commit_message: "feat(seo-audits): add a safe on-disk cache for crawl snapshots"

### task-06: The crawl orchestration

- scope_whitelist: [packages/seo-audits/src/lib/crawler.js, packages/seo-audits/test/lib/crawler.test.js]
- depends_on: task-02, task-03, task-04, task-05
- description: New module `crawlSite(input)` per the contract and audit spec, all dependencies injectable: environment parsing with
  the documented defaults and clamps; `LHCI_SEO_CRAWL=0` returns a "disabled" artifact with no requests; cache read (a hit returns
  `cached`, adding the audited page if missing); robots.txt via `fetchBytes` (present / absent / unavailable, honoured or
  ignored; unavailable means only the audited page is requested); seeds from the audited page, the DOM links and the sitemap
  (`collectSitemap`); `checkUrls` with `fetchPage` at the 512 KiB cap and the crawler's user-agent; same-origin redirects for at
  most 3 rounds with the request cap; extraction through `extractPage`; the snapshot built and written. Never throws. Tests with
  scripted fetchers: every environment variable and clamp; disabled; cold crawl; cache hit with no requests; audited page missing
  from a reused snapshot; robots honoured (blocked URLs recorded and never requested), ignored, absent, unavailable; the exact list
  of requested URLs is always same-origin (cross-origin seeds, cross-origin and metadata-address redirect targets, a lookalike
  host); redirect following and its 3-round and request caps; a redirect loop; a page cap that holds with more seeds than slots;
  the time budget marking the rest `not-checked` and setting `truncatedByBudget`; non-HTML and non-2xx pages recorded without
  extraction; one page failing while others succeed; everything failing gives `unavailable` with the reason; an exception thrown by
  a dependency is caught and reported, not propagated.
- commit_message: "feat(seo-audits): add the bounded site crawl"

### task-07: The SiteCrawl gatherer

- scope_whitelist: [packages/seo-audits/src/gatherers/site-crawl.js, packages/seo-audits/test/gatherers/site-crawl.test.js]
- depends_on: task-06
- description: `SiteCrawl extends BaseGatherer` (`supportedModes: ['snapshot', 'navigation']`). `getArtifact` reads, with one
  `driver.executionContext.evaluate` of a fixed function, the same-origin `<a href>` links (document order, at most 200) and the
  rendered visible text length, calls `crawlSite`, adds `auditedRenderedTextLength`, and pushes a run warning when the crawl could
  not run (naming the cause and, when the private-network policy refused it, `LHCI_SEO_ALLOW_PRIVATE_NETWORK`). Exports
  `skippedWarning`. Tests (no browser): the in-page function's output shape on a small jsdom document if available, otherwise
  through an injected page reader; the warning text for each unavailable reason; a disabled crawl adds no warning; the artifact is
  passed through unchanged.
- commit_message: "feat(seo-audits): add the SiteCrawl gatherer"

### task-08: The crawl-coverage audit

- scope_whitelist: [packages/seo-audits/src/audits/crawl-coverage.js, packages/seo-audits/src/lib/crawl-coverage.js, packages/seo-audits/test/lib/crawl-coverage.test.js, packages/seo-audits/test/audits/crawl-coverage.test.js]
- depends_on: task-02
- description: Informational audit (`scoreDisplayMode: informative`) and its pure table builder in `src/lib/crawl-coverage.js`:
  `displayValue` ("Crawled 31 of 50 pages (4 blocked by robots.txt, 2 errors)"), a table of at most 100 rows plus an "N more not
  shown" row, and notes for budget, page cap, robots.txt and "reads server HTML only". Not applicable, with the reason, for a
  disabled or unavailable crawl and a missing artifact; never throws. The audit file is thin and registers
  `requiredArtifacts: ['SiteCrawl']` with the usual `@ts-expect-error`. Tests: each display and note case, row cap, a snapshot with
  every skip reason, missing/null/empty artifacts, enormous titles and URLs cut.
- commit_message: "feat(seo-audits): add the crawl-coverage audit"

### task-09: Register the gatherer and audit

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-07, task-08
- description: Add the `SiteCrawl` artifact, the audit path and the `seo-extended` ref (weight 1); update the header comment and the
  config test (forty to forty-one, plus the artifact id). The test resolves the config in real Node ESM, so it is also the check
  that every new module loads (including `htmlparser2` under ESM) and the audit-id guard still passes.
- commit_message: "feat(seo-audits): register the SiteCrawl gatherer and crawl-coverage audit"

### task-10: Integration test against a real local site

- scope_whitelist: [packages/seo-audits/test/gatherers/site-crawl.integration.test.js]
- depends_on: task-09
- description: Test-only. A real local HTTP server (planted pages: duplicates, a redirect, a robots.txt that disallows one path, a
  cross-origin link to a spy server, a non-HTML file, a huge nested page) crawled through the **real** `safeFetchPrefix` and
  `safeFetchBytes` with `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` set inside the test (it is read per request), using a temporary cache
  directory. Asserts: the snapshot's pages and skips, robots honoured, the spy server receiving zero requests, a second crawl served
  from the cache with the server seeing no new requests, a corrupt cache file re-crawled, the time budget enforced against a hanging
  route, and the hostile nested page extracted within the bound.
- commit_message: "test(seo-audits): crawl a real local site through the safe fetch path"

### task-11: README

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-09
- description: Document the crawler: what it does and does not do (server HTML only, depth 1, same origin), the six environment
  variables with defaults and clamps, the off switch, robots.txt honouring, the cache (location, lifetime, the safe-directory rule),
  the cost on a cold cache, the "pruned when no audit needs it" behaviour, the script-rendered-site caveat, and that `crawl-coverage`
  is informational and should not be asserted; update the audit count (forty to forty-one).
- commit_message: "docs(seo-audits): document the site crawler"
