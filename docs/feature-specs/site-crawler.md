# Feature: Site Crawler (multi-page crawling infrastructure, core first)

- slug: site-crawler
- requested: 2026-10-01
- type: tooling

## Summary

A bounded, polite, same-origin crawler **core** that the audits of Phase 7 (and later Phase 8, the deferred Phase 5
link checks and Phase 11) read, so an audit can judge **a page against the rest of the site**. Every audit so far sees
one page; this adds the one thing that was missing, a snapshot of many pages.

It runs as a **Lighthouse gatherer** (`SiteCrawl`) inside the normal run. `lhci collect` runs each Lighthouse run
as a separate child process, so the crawl result is written to an **on-disk cache keyed by origin** and reused by
the other runs of the same `collect` (several URLs, several `numberOfRuns`): the site is crawled once, nothing in
the workflow changes, and `lhci autorun` just works.

Decisions made with the developer (the intake's blocking questions, Phase 7 planning, 2026-10-01):

1. **Delivery**: in-run gatherer plus disk cache (not a separate command, though the crawler is a library so a
   command can be added later).
2. **robots.txt is honoured by default**: only URLs robots.txt allows for the crawler's own user-agent are
   requested; the others are recorded as "blocked". An environment variable turns this off for auditing one's own
   staging site.
3. **Default bounds: 50 pages and 120 s total**, overridable by environment variables and never by the page being
   audited.
4. **Scaled down to a core first** (the developer's choice, 2026-10-01, after asking whether a full crawler was
   necessary now): the bounded fetch, the snapshot format and the cache, **seeded from the sitemap URLs and the audited
   page's own internal links, at depth 1** (the pages those seeds link to are not followed). Link-following to greater
   depth (the original depth 3) is deferred to Phase 8, which is the first thing that needs it. The snapshot format
   already stores each page's internal links, so adding depth later changes how the queue is fed, not what is stored,
   and nothing built now is thrown away.

What the crawler produces is a versioned **snapshot** of the pages it visited, enough for the four Phase 7 audits:
for each URL its final URL and redirect chain, status, content type, sizes, the head fields (`<title>`, meta
description, canonical(s), robots meta, `X-Robots-Tag`), the first few `<h1>` texts, the visible text reduced to a
hash and a word count (for duplicate-content and thin-content checks), and the page's internal links (kept now so
Phase 8 can use them). Raw HTML is never stored.

## Concrete pass/fail example

This is infrastructure, so "pass" means the crawl behaves, not that an audit scores:

- **Pass**: auditing `https://example.com/` with a 30-page site: the crawl starts from the audited page, the
  sitemap URLs and the audited page's internal links (depth 1), visits the same-origin pages, skips two URLs robots.txt disallows
  (recorded as blocked), writes one snapshot to the cache, and a second Lighthouse run for `https://example.com/about`
  in the same `lhci collect` reuses it with no new requests to the site.
- **Bounded on a hostile site**: a site with 100,000 links
  on one page, a server that never answers, a redirect to another host, a page that is 50 MB of nested `<div>`: the
  crawl still ends inside the time budget, with at most 50 pages, never requests another origin, never reads more
  than the body-size cap per page, and never takes more than a fixed time to parse one page.
- **Fail (what the crawler must not do)**: request a URL on another origin, request a URL robots.txt disallows
  while honouring it, exceed the page/depth/time bounds, write the cache non-atomically so a concurrent run reads a
  half-written file, or block the Lighthouse run past its own timeout.

## Gatherer needs

- New gatherer required: **yes**, `SiteCrawl` (Node side, outbound requests, like `SitemapDocuments` and `UrlVariants`).
- What it collects: the snapshot above. Seeds: the audited page's own internal links (from the live DOM) and the
  sitemap URLs (reusing Phase 4's `SitemapDocuments` discovery logic through its library functions, since a gatherer
  cannot depend on another third-party gatherer's artifact).
- Collection method: `src/lib/safe-fetch.js` (SSRF-protected, no automatic redirects, address policy, the private
  network opt-in `LHCI_SEO_ALLOW_PRIVATE_NETWORK`); a bounded worker pool; an HTML extractor for the head fields,
  the visible text and the links.

## Scope

- Package(s) affected: `packages/seo-audits` only (new `src/crawler/` or `src/lib/` modules, one gatherer, tests,
  README). No edit to `packages/utils` or `packages/cli`.
- Out of scope: following links to a depth greater than 1 (Phase 8); JavaScript rendering (the crawler reads server HTML; the audited page itself is rendered by
  Lighthouse as always); crawling other origins or subdomains; following `nofollow`/robots-meta rules beyond
  recording them; authentication and cookies; images, CSS and JS files (HTML only); respecting `Crawl-delay`
  beyond a fixed polite request rate; the four Phase 7 audits themselves (separate features that read the
  snapshot); Phase 8's link analysis.
- Does not change any existing audit or gatherer. `SitemapDocuments`'s discovery code is reused, not modified.

## Open questions

For Agent 01/02 to settle in design (none blocks Gate 0; each affects security or cost):

- **Parsing safety.** Full-body parsing is a new denial-of-service surface: Finding 5 showed `parse5` is quadratic in
  the nesting of block elements, and the 2,000-tag input cap that fixed it only protects the head. A body cap near
  512 KiB parsed with `parse5` would be roughly 64 times worse than the 64 KiB case that cost 1.6 s. Likely answer: a
  streaming tokenizer (linear; `parse5-sax-parser` or another small dependency, which would be a new dependency to
  declare) or a hard cap on nesting depth, with timing tests on adversarial input. To be decided with a measurement.
- **Body-size cap and text extraction rules** (what counts as visible text: drop `<script>`, `<style>`,
  `<noscript>`, hidden elements; collapse whitespace; lowercase) since the duplicate-content hash depends on them.
- **Cache design**: location (a temp directory, overridable), key (origin plus the bounds, so changing a bound does
  not reuse a stale snapshot), time-to-live (a few minutes), atomic write (write then rename), size cap, and what a
  corrupt or old-version file does (ignored and re-crawled).
- **Crawl traps and URL normalisation**: dropping fragments, a cap on query-parameter permutations per path, a cap on
  links read per page, how redirects are followed (same-origin hops only, a small limit, recorded). With depth fixed at
  1 an endless-calendar trap cannot grow the crawl, but the page cap and the per-page link cap still apply.
- **User-agent string and politeness**: the crawler's own name, a fixed per-host request rate, concurrency (5).
- **Time budget vs Lighthouse's own timeout**: the crawl happens during `getArtifact`, so its 120 s must not push a run
  past a limit or leave Chrome idle; whether to crawl in the gather phase before or after navigation.
- **Environment variables** (names and clamps): pages, total time, robots.txt on/off, cache directory, cache TTL (no depth
  variable until Phase 8 adds link-following).
- **What happens when the crawl fails or is skipped** (private host without the opt-in, no links, network down): the
  Phase 7 audits must be not-applicable with the reason, never a false "no duplicates".
