# Feature: Link-graph crawler (depth 3 from the homepage, snapshot v2)

- slug: link-graph-crawler
- requested: 2026-10-05
- type: tooling

## Summary

The Phase 7 crawler stops at depth 1 and records each page's links as bare URLs. Phase 8's audits (link counts, dead ends, orphan
pages, crawl depth, broken and redirecting internal links, anchor-text diversity, pagination and trap detection, broken external
links) all need the **link graph**, so this extends the existing `SiteCrawl` gatherer and crawl library, without a new gatherer and
without a new kind of outbound request:

1. **Link-following to depth 3.** The crawl is seeded from the homepage, the audited page, the audited page's links and the sitemap
   URLs, then follows same-origin links on every crawled page for up to 3 hops from any seed, inside the **existing bounds** (50 pages,
   120 s, 5 concurrent requests, robots.txt honoured, same origin only).
2. **The homepage is an extra seed** (one request), because crawl depth is measured from the homepage.
3. **Snapshot version 2.** Per link it adds the anchor text (clipped) and the `rel` flags beyond `nofollow` (`sponsored`, `ugc`); per
   page it adds the discovery depth, a capped list of **external** links (URL and anchor text, never requested here), and the
   pagination signals (`<link rel="next|prev">` and `rel="next|prev"` anchors). Raw HTML is still never stored. The cache is keyed by
   version, so a version 1 file is ignored and the site is crawled again.
4. **An environment variable** `LHCI_SEO_CRAWL_MAX_DEPTH` (default 3, clamped 1 to 5) sets how far links are followed.

The audits themselves are separate items (Phase 8, items 1 to 6) that read this snapshot.

Decisions made with the developer (Phase 8 planning, 2026-10-05): depth 3; depth measured from the homepage; all four audit groups
and broken external links are built in this phase (the last on by default and bounded, as its own item with its own security
design).

## Concrete pass/fail example

Pass: auditing `https://example.com/blog/post-1` on a 40-page site. The crawl requests the homepage, the audited page, its links and the
sitemap URLs, then follows links from those pages for up to 3 hops, stops with 40 pages crawled and nothing skipped, and writes one
version-2 snapshot. Every page has a depth, every link has its anchor text, and a second Lighthouse run in the same `lhci collect`
reuses the cache with no new requests.

Pass (large site): a site with 10,000 pages stops at 50 pages in breadth-first order (shallower pages before deeper ones), records
the rest as "over the page cap", and the snapshot says the crawl is incomplete so the audits that need a complete graph can say so.

Fail (what it must not do): request another origin, request a URL robots.txt disallows, follow links from a page deeper than the depth
bound, exceed 50 pages / 120 s / the request cap, store raw HTML, read a version 1 cache file as version 2, or change what the Phase 7
audits report on a depth-1 site other than by showing them more pages.

## Gatherer needs

- New gatherer required: **no**. The existing `SiteCrawl` gatherer and its libraries change (`crawler.js`, `crawl-extract.js`,
  `crawl-snapshot.js`, `crawl-cache.js`, the coverage audit's table).
- Data collected, new: homepage seed, discovery depth per page, anchor text and `rel` flags per internal link, external links per
  page (capped), pagination signals per page.
- Collection method: unchanged (`safe-fetch.js`, the SSRF policy, no automatic redirects, a bounded worker pool).

## Scope

- Package(s) affected: `packages/seo-audits` only (and its README, `crawl-coverage`'s table and notes). No edit to `packages/utils` or
  `packages/cli`.
- Out of scope: the Phase 8 audits (items 1 to 6); any request to another origin (broken external links is item 6, with its own
  security design); status-only checks of internal link targets the crawl did not reach (item 3 decides that); JavaScript rendering;
  raising the page cap; honouring `nofollow` for crawling (it is recorded, not obeyed, as before); a `seo-crawl` command.
- Changes behaviour of existing audits in one intended way: the four Phase 7 audits and `crawl-coverage` will see more pages (pages
  at depth 2 and 3), so their "compared among N pages" numbers grow.

## Open questions

For Agent 01/02 to settle in design; none blocks Gate 0 (each affects cost, size or compatibility):

- **Page cap versus depth.** With the page cap kept at 50, a large site is cut off near the homepage: crawl depth, orphan pages and the
  link counts are then judged on a partial graph. Likely answer: breadth-first order so the cap cuts the deepest pages first, and the
  snapshot records whether the cap or the budget cut the crawl, so the audits that need a complete graph are not applicable then
  instead of wrong. If this proves too limiting, the cap is the lever (`LHCI_SEO_CRAWL_MAX_PAGES`, already up to 200).
- **Discovery depth versus click depth.** The crawler follows up to the depth bound from any seed, but the Phase 8 "crawl depth from the
  homepage" metric is the shortest click path from the homepage over the stored links. Where each is computed, and what a page the
  crawl cannot place (reached only from the sitemap, or deeper than the bound) reports.
- **Snapshot size.** 200 pages x 200 links x anchor text can approach the 16 MiB cache cap. Bounds to choose: anchor length, links per
  page (today 200), external links per page and in total, and what happens past the cap.
- **Seed priority and `source` values.** The homepage needs its own `source` (today `audited | link | sitemap`); the Phase 7
  audits and `crawl-coverage` read `source`, so the type change must be checked against them. Which seeds win when the cap is hit.
- **Homepage edge cases**: robots.txt disallowing the root, the root redirecting to another path or another host, the audited URL
  being the root already (dedupe).
- **Pagination signals**: which attributes and elements to record (`<link rel>` in the head, `<a rel>` in the body), and a cap.
- **Cost**: the request cap (3x pages) and time budget stay as they are, but a deeper crawl makes hitting them likelier; the
  `crawl-coverage` notes and the README's cost sentence need to say so.
- **Cache compatibility**: version in the key and in the file, and what a version 1 file does (ignored, re-crawled).
