# Audit spec: Site Crawler (core)

- slug: site-crawler
- upstream-sync checked against: lighthouse@12.6.1 (installed; `@lhci/utils` is this workspace's own 0.1.0). `BaseGatherer`
  (`meta = {supportedModes}`, `getArtifact(passContext)`), the `artifacts: [{id, gatherer}]` config entry, and the
  `passContext.baseArtifacts.{URL,LighthouseRunWarnings}` fields are the same ones `SitemapDocuments`, `UrlVariants` and
  `IndexabilitySignals` already use; nothing changed since the last gatherer was added. No upstream pull since, so no
  changelog range to scan.

One new gatherer (`SiteCrawl`), a pure extraction and snapshot library, a secure disk cache, and one informational audit
(`crawl-coverage`) so the crawl is visible and verifiable. The four Phase 7 audits are separate features that read the
artifact.

## Verified before designing (measured 2026-10-01)

- **How `lhci collect` runs Lighthouse**: `packages/cli/src/collect/node-runner.js` runs `node <lighthouse-cli>` as a
  **child process per run** (environment inherited). No memory is shared between runs, so "crawl once" needs a disk cache.
- **Lighthouse prunes unused gatherers**: `core/config/filters.js` keeps only the artifacts that the selected audits require
  (`onlyAudits`, `onlyCategories`, `skipAudits`). A run limited to Lighthouse's own categories does not crawl; a run that
  includes the `seo-extended` category does.
- **`parse5` cannot parse full bodies safely.** Hostile 512 KiB inputs, same machine:

  | input (512 KiB) | `parse5` | `htmlparser2` 6.1.0 |
  |---|---|---|
  | normal page (14,367 tags, links) | 76 ms | 22 ms |
  | 200,000 nested `<div>` | **108,839 ms** | 46 ms |
  | 60,000 nested `<ul><li>` | **113,929 ms** | 43 ms |
  | misnested `<b><i>`, nested table, unclosed `<a>`, 100k links, 170k `<p>`, entity run, comment flood, huge attributes, `<script>` full of `<` | 22 to 176 ms | 11 to 53 ms |

  `parse5` is quadratic in nesting (Finding 5 in `security-findings.md`, which the head-only cap fixed); at 512 KiB it is
  about **110 s for one page**. `htmlparser2` is a streaming tokenizer with no tree: linear, worst case **53 ms**.
  **Decision: the crawler extracts with `htmlparser2`.** It is already in the dependency tree (`htmlparser2@^6.1.0`, range
  already in `yarn.lock`), so declaring it adds no lockfile change (to be confirmed with `yarn install --frozen-lockfile`).
  Its tokenizer is not HTML5 tree construction, which is acceptable here because only text, links and head fields are read;
  script, style, noscript and template content is skipped by element tracking.
- **The shared fetch hard-codes its request headers** (`safeFetchPrefix` sends only `Accept` and `Accept-Encoding`), so
  identifying the crawler needs a small, sanitised, additive `userAgent` option there.

## Gatherer

- New gatherer: `SiteCrawl` (`src/gatherers/site-crawl.js`), registered as `{id: 'SiteCrawl', gatherer: ...}`;
  `supportedModes: ['snapshot', 'navigation']`.
- Data collected: a versioned **snapshot** of up to 50 same-origin pages plus the audited page: for each URL its final URL and
  same-origin redirect chain, status, content type, bytes read, `truncated`, `<title>`, meta description, canonicals, robots
  metas, `X-Robots-Tag`, the first five `<h1>` texts, a sha-256 of the normalised visible text with its length and word
  count, and the page's internal links (capped). Raw HTML is never stored. Also what was skipped and why.
- Collection method (all in `getArtifact`, Node side):
  1. **Cache read**: `crawl-cache.js` looks up the origin's snapshot (see Cache); a fresh valid one is reused and no crawl runs.
  2. **Seeds**, in priority order, deduplicated by normalised URL: the audited page (always); the page's own internal links
     read from the live DOM with one `driver.executionContext.evaluate` (same-origin `<a href>`, fragment dropped, document
     order, at most 200); the sitemap URLs found through the existing `collectSitemapDocuments` library function (Phase 4's
     robots.txt `Sitemap:` discovery, one level of index). With `P` pages allowed: links get `ceil((P-1)/2)` slots and the
     sitemap the rest, each chosen evenly and deterministically (`pickEvenly`); a short list gives its slots to the other.
  3. **robots.txt** (honoured by default): fetched once with `safeFetchBytes` (1 MiB, 5 s); URLs it disallows for the
     crawler's own user-agent are not requested and are recorded as `blocked`. Absent (4xx) allows everything; a 5xx or network
     failure is recorded as `unavailable` and **no page other than the audited one is requested** (a crawler must not guess
     when it could not read the rules). The audited page is always requested once so every page is extracted the same way.
  4. **Fetch** through `checkUrls` (Phase 4's bounded worker pool: 5 at a time, 5 s each, one retry for a network error only,
     total budget) with `safeFetchPrefix` at a **2 MiB** body cap (512 KiB until Phase 18, raised because JSON-LD often sits at the end of a heavy page; the extractor is linear so only download time grows) and `Accept-Encoding: identity`. Same-origin only: a seed on
     another origin is recorded as skipped and never requested.
  5. **Redirects**: a 3xx whose `Location` is on the same origin is requested once more, for at most 3 rounds, each hop
     recorded; a redirect to another origin is recorded and never requested. Hops count against a request cap of 3 x pages.
  6. **Extract** each 2xx HTML body with `htmlparser2` (see Extraction), then write the snapshot to the cache.
  7. If the audited page was not in a reused snapshot, it is requested and extracted alone and added to the returned artifact.
- **Depth**: seeds only. The links of the pages that were fetched are stored but not followed (link-following to a greater
  depth is Phase 8's).
- **Time**: the crawl budget (default 120 s) bounds step 4 onwards; running out marks the remaining URLs `not-checked` and
  sets `truncatedByBudget`. The gatherer never throws: every failure is data, and a run warning names the cause when the
  crawl could not run (the same pattern as `SitemapDocuments`, including the `LHCI_SEO_ALLOW_PRIVATE_NETWORK` hint).

### Extraction (`src/lib/crawl-extract.js`, pure)

`htmlparser2.Parser` with callbacks only (no DOM). A stack of "skipping" flags tracks `script`, `style`, `noscript`,
`template`, `head` (for text), and elements with a `hidden` attribute; text outside them is the visible text. Head fields come
from the events before and inside `<head>`: first `<title>`, first `<meta name=description>`, `<link rel~=canonical>` (up to 5),
`<meta name=robots|googlebot|bingbot>`. `<h1>` text (first 5, 300 characters each). `<a href>` resolved against the page URL,
kept when `http(s)` and same origin, fragment dropped, `rel~=nofollow` noted, at most 200 per page. The visible text is
whitespace-collapsed and lower-cased, then hashed (sha-256) and counted; **it is not stored**. Text, title and description are
capped in length before hashing/storing. Every cap is a constant.

### Snapshot (versioned, `version: 1`)

```
{version, origin, createdAt, bounds:{pages, budgetMs, robots:'honour'|'ignore', userAgent},
 robots:{state:'present'|'absent'|'unavailable'|'ignored'},
 seeds:{audited, links, sitemap},
 pages:[{url, finalUrl, redirects:[{url,status,location}], status, contentType, bytes, truncated,
         title, description, canonicals[], robotsMetas[{name,content}], xRobotsTag[], h1[],
         textHash, textLength, wordCount, links[{url,nofollow}], extraction:'ok'|'skipped-not-html'|'skipped-status'|'error'}],
 skipped:[{url, reason:'blocked-by-robots'|'cross-origin'|'over-page-cap'|'not-checked'|'failed', detail}],
 stats:{requests, elapsedMs, truncatedByBudget}}
```

The artifact is the snapshot plus `auditedUrl`. Field-for-field this is what the four Phase 7 audits need and what Phase 8 will
need, so adding link-following later changes how the queue is fed, not what is stored.

### Cache (`src/lib/crawl-cache.js`)

- **Where**: `LHCI_SEO_CRAWL_CACHE_DIR`, default `<os.tmpdir()>/lhci-seo-crawl-<uid>`, created with mode `0o700`.
- **Key**: sha-256 of `{origin, snapshot version, pages, robots mode, user-agent}`, so changing a bound never reuses a stale file.
- **Freshness**: `LHCI_SEO_CRAWL_CACHE_TTL_SECONDS`, default 600; `0` disables the cache.
- **Safe on a shared machine**: the directory must be a real directory (not a symlink), owned by the current user, mode
  without group/other access; otherwise the cache is not used (the crawl still runs, uncached). A file that is corrupt, an old
  version, or older than the TTL is ignored and re-crawled.
- **Atomic**: write `<name>.<pid>.tmp` then `rename`, so a concurrent run never reads a half-written file.
- Contents are only the extracted snapshot, no raw HTML, no cookies, nothing the user did not already have access to.

### Request identity and environment

- **User-agent**: `lhci-seo-audits-crawler/1.0` (constant, sent through a new additive `userAgent` option on
  `safeFetchPrefix`, validated as printable ASCII, at most 200 characters, no CR/LF); robots.txt is matched against that
  name, falling back to `*`.
- **Environment variables** (read per run, clamped, never from the page): `LHCI_SEO_CRAWL_MAX_PAGES` (default 50, 1 to 200),
  `LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS` (default 120, 10 to 600), `LHCI_SEO_CRAWL_RESPECT_ROBOTS` (default on; only the exact
  values `0` / `false` turn it off), `LHCI_SEO_CRAWL_CACHE_DIR`, `LHCI_SEO_CRAWL_CACHE_TTL_SECONDS`, and
  **`LHCI_SEO_CRAWL=0`** to switch the crawl off entirely (the gatherer then returns a "disabled" artifact and the audits that
  read it are not applicable). `LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies as everywhere.

## Audit

- Audit id: `crawl-coverage` (informational; its only purpose is to make the crawl visible and verifiable, and to be the
  place Phase 7 audits point to for "how much of the site was seen").
- Scoring function: none; `scoreDisplayMode: informative` (Lighthouse normalises the score to 1).
- Failure threshold(s): none.
- Display: `displayValue` such as "Crawled 31 of 50 pages (4 blocked by robots.txt, 2 errors)"; not applicable, with the
  reason, when the crawl is disabled, could not run, or the artifact is missing.
- `DetailsType`: table, one row per URL: `url`, `status` (or the skip reason), `title`, `words`, `source` (seed kind:
  audited / link / sitemap), capped at 100 rows; plus a note when the crawl was cut by the time budget, the page cap or
  robots.txt, and a note that it reads server HTML only (a script-rendered site can look like identical empty shells).

## Category placement

- Category: existing fork category `seo-extended`, weight 1 (informational, so it never moves the score).

## Extension point

`packages/seo-audits/src/lighthouse-config.js`, the custom Lighthouse config referenced through `ci.collect.settings.configPath`
(`extends: 'lighthouse:default'`): one `artifacts` entry (`SiteCrawl`) because this is a new gatherer (which is why a
`plugins` entry could not do it), one `audits` entry, one `auditRefs` entry. `test/lighthouse-config.test.js` is updated
(forty to forty-one). `package.json` declares `htmlparser2: ^6.1.0`.

## Risks / open questions

- **Default-on cost.** Anyone running the fork config with the `seo-extended` category pays up to 120 s and up to ~100 requests on
  a cold cache. The off switch (`LHCI_SEO_CRAWL=0`) and the pruning by selected audits are the mitigations; Gate 1 should
  confirm "on by default" is what the developer wants.
- **Script-rendered sites look like duplicates.** The crawler reads server HTML. A single-page app serves the same shell for
  every route, so every page can have the same title and an empty body, which the Phase 7 audits would report as duplicates.
  The snapshot keeps `textLength` and the artifact includes the audited page's rendered text length for comparison; the
  Phase 7 audits must treat shell pages as "cannot judge", and `crawl-coverage` says so. Raised here so it is designed in.
- **`htmlparser2` 6.1.0 is old** (2021) and was not checked against a vulnerability database from here (no lookup was
  available). The risk is bounded by the body cap, the timing tests on hostile input, and extraction only.
- **Double fetch of robots.txt and the sitemap** on a cold crawl (`SitemapDocuments` fetches them in the same run too):
  accepted, small and once per cache lifetime; noted rather than coupling two gatherers.
- **Time inside `getArtifact`**: a 120 s crawl runs while Chrome is idle after the page loaded. Acceptable; a wait could in
  principle collide with an outer timeout in a caller that sets one, so the budget is also clamped to 600 s.
- `safe-fetch.js` is modified additively (`userAgent` option); no existing behaviour changes. `sitemap-url-sample.js`'s
  `checkUrls` is reused unchanged.
