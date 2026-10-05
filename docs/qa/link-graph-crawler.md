# QA checklist: Link-graph crawler (Phase 8 item 0)

- slug: link-graph-crawler
- build mode: lightweight (design conversation, then code); spec kept as the design record: `docs/feature-specs/link-graph-crawler.md`
- branch: `feat/link-graph-crawler`, off `phase-8-internal-linking`

Covers the extension of `SiteCrawl` and the crawl library: the homepage seed, breadth-first link-following to depth 3, snapshot version 2 (depth,
anchor text, `rel` flags, external links, pagination links, sitemap URL list, completeness flags), the file and query-variant guards, the cache key,
and the `crawl-coverage` table. Verified against a planted local site over the real fetch path, spy servers, and a real `lhci collect`.

## Functional

- [x] **Default crawl** (audited `/s2/a1` on a planted site with depth-1 to depth-3 sections, a `/deep/N` chain, a `/list?page=N` pagination series, a
      file link, a robots-disallowed directory, an other-origin link): **41 pages, 42 requests, 72 ms**; depths `{0: 2, 1: 7, 2: 14, 3: 18}`; the
      homepage was the second seed (`source: home`); `cutByDepth: true` because the `/deep` chain goes on.
- [x] **Never requested**: `/private/x` (robots.txt), `/logo.png`, `/file.pdf`, and the other-origin link (a spy server received **0** requests). Skipped
      list: `blocked-by-robots` 1, `not-a-page` 2, `query-variants` 4 (9 variants of `/list`, 5 requested).
- [x] **Data stored**: anchor text (`Home`, `/s1`...), external links with their anchor (recorded, not requested), `rel=next` read from `/list?page=1`.
- [x] **Breadth-first under a tight cap** (`LHCI_SEO_CRAWL_MAX_PAGES=15`): depths `{0: 1, 1: 4, 2: 10}`, `overPageCap: true`, 18 URLs recorded as over the cap.
- [x] **Depth setting**: depth 1 crawled 5 pages (`cutByDepth: true`); depth 5 reached depth 5 on the `/deep` chain.
- [x] **Crawled once across processes** (a real `lhci collect`, 2 URLs x 2 runs = four Lighthouse processes): 41 distinct paths; only the two
      audited URLs were requested more than once (3 times: two Lighthouse loads and one crawl request); robots.txt twice (the crawler's and the sitemap
      discovery's), the sitemap once; **one cache file**.
- [x] **Unit tests**: 75 suites / 1,350 tests in `seo-audits` (the crawler suite alone has 68), typecheck and lint clean.

## Safety, run against hostile servers (real fetch path)

- [x] **Endless fan-out** (every page links to 250 new pages and 60 external URLs), maximum settings (200 pages, depth 5): 200 pages, 201 requests (cap 600),
      2.2 s, 500 distinct external links kept (the total cap), `overPageCap: true`.
- [x] **Parsing**: hostile 512 KiB inputs for the new reads (unclosed `<a>` flood, one huge anchor, alt-text flood, external-link flood, pagination flood):
      all under 2 s with bounded output (asserted in the extractor tests).
- [x] **Cache**: the snapshot version and depth are in the key; a version 1 file is rejected by `isSnapshot`.

## Findings

- **Seed split had to change.** With the Phase 7 split, seeds alone filled the 50-page cap and link-following had no room; seeds now take at most half the slots
  and leftover sitemap URLs fill spare ones. The Phase 7 audits therefore see a different, deeper sample (intended, in the changelog).
- **My two test-fixture mistakes**: `/app.js?v=2` is a file (skipped, correctly), and `not a url` resolves as a relative path. Fixed in the tests, not the code. One
  real bug found by live QA of the extractor: pagination came back empty because I passed the `rel` string into a function that looped over its characters;
  fixed with a test.
- **Finding 10 (low, open, accepted)**: a hostile site with very long link URLs gives a 20 MiB snapshot at the default 50 pages (81 MiB at 200), so the cache is
  refused and each run re-crawls; about 360 MB resident at the default (750 MB at 200 pages). See `security-findings.md`.

## Not verified

- `packages/viewer` rendering of the new `crawl-coverage` Depth column; `npm run start:seed-database`; a real GitHub Actions run (listed in `docs/open-items.md`).
- A re-run of the changed suites under Node 18.20.8 (CI pins it).
- The audits that will read the new data (Phase 8 items 1 to 6) do not exist yet.
