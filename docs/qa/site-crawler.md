# QA checklist: Site crawler (`SiteCrawl`, `crawl-coverage`)

- slug: site-crawler
- merged: cebec83 (into `phase-7-duplicates`, ff-only; `base_commit` d53c327)

Covers the `SiteCrawl` gatherer, the crawl library, the cache, the `userAgent` option on `safeFetchPrefix`, and the informational
`crawl-coverage` audit. Verified with real Lighthouse runs, a real `lhci collect` (four separate Lighthouse processes), a local
site with planted pages, hostile servers, and four public sites, not only unit tests.

## Functional

- [x] **Cold crawl, real Lighthouse run** (`http://localhost:9501/`, planted site): "Crawled 8 of 50 pages (1 blocked by
      robots.txt)": the audited page, its links (`/a`, `/dup1`, `/dup2`, a redirect `/old` -> `/new`, `/thin`), and the sitemap's
      `/s1` and `/s2`. `/private/x` (disallowed by robots.txt) is listed as blocked and **never requested** (server log).
- [x] **Another origin is never requested**: a link to a spy server on another port, and a page link and sitemap URL to it, were
      listed as skipped; the spy received **zero** requests.
- [x] **Crawled once across processes** (the property unit tests cannot show): a real `lhci collect` with 2 URLs x 2 runs (four
      separate Lighthouse processes) made exactly **one** request to each of `/dup1`, `/dup2`, `/old`, `/new`, `/s1`, `/s2` and
      `/thin`; robots.txt twice (the crawler's and the existing sitemap discovery's) and the sitemap once; `/` and `/a` three
      times each (two Lighthouse page loads plus one crawl request). One cache file was written.
- [x] **Without `LHCI_SEO_ALLOW_PRIVATE_NETWORK`** (the CI default for `localhost`): `crawl-coverage` not applicable, and the run
      warning reads "The site crawl could not run: no page could be requested: refusing to connect to "localhost" ... set
      LHCI_SEO_ALLOW_PRIVATE_NETWORK=1."
- [x] **`LHCI_SEO_CRAWL=0`**: not applicable ("the crawl is switched off"), zero requests beyond Lighthouse's own.
- [x] **Pruned when unused**: a run selecting only `--only-categories=seo` made no crawl requests (Lighthouse skipped the gatherer).
- [x] **Script-built site** (a shell served for every route): the note "The audited page shows 1243 characters of text in a
      browser but only 0 in the HTML the crawler received" appears.
- [x] **Public sites** (10 pages max, 11 to 20 s per run): `example.com` (1 page); `nodejs.org` (8 of 10, 1 blocked by robots.txt,
      1 error: a real 404 in its own sitemap, `/en/blog/release/v164.2`; the other-origin link skipped); `react.dev` and
      `developer.mozilla.org` (10 of 10, the rest listed as "over the page cap").

## Safety, run against hostile servers (real fetch path)

- [x] A page with **100,000 links**: one page, an 11 KB snapshot, 72 ms. 300 seeds and **200 pages of 400 KB each, 200 links each**:
      2.6 s, 201 requests, a 2.2 MB snapshot (under the 16 MiB cache cap).
- [x] An **endless body**, a **trickling body** and an **endless redirect** chain among the seeds: the crawl ended in 5 s with every
      one recorded as truncated or "too many redirects", 8 requests in total.
- [x] **Cache attacks** (real filesystem): a cache directory that is a symlink to another directory writes nothing there and the
      crawl still runs; a forged snapshot planted in a world-writable (0777) directory is **ignored** (the real server is requested);
      a cache file that is a symlink to `/etc/passwd` is not followed; three crawls in parallel leave exactly one valid cache file.
      (A valid file in the user's own 0700 directory is trusted, by design: whoever can write there is the user.)

## Integration

- [x] **`lhci assert`, real run**: `'crawl-coverage': ['error', {minScore: 1}]` passes (informative audits normalise to 1), as the
      README says; there is nothing to gate on.
- [x] **Report rendering** (Lighthouse's own HTML report): an informational row "Site crawl coverage: Crawled 8 of 50 pages (1
      blocked by robots.txt)". (In a single-audit run the category shows 0 because informational audits carry no score.)
- [x] **Core categories unchanged**: `seo` (1) and `best-practices` (0.89) and all 32 core audit scores are identical with and
      without the fork config (0 differences).
- [x] **Config**: registered through `configPath` alone; six environment variables, no `.lighthouserc.js` key.
- [ ] `packages/viewer` rendering was **not** checked; `npm run start:seed-database` was **not** run; no real GitHub Actions run.

## Findings

- **Misleading note wording (fixed).** On `example.com`, a static page, the note claimed the content was "built by script" (911
  characters in a browser, 167 in the crawler's HTML). The cause is not script: `example.com` returns a 12 KB multilingual page to
  a browser and a 713-byte page to a non-browser request. The note now says either the content is built by script *or* the server
  answers the crawler differently from a browser.
- **A wrong theory of mine, measured and dropped.** After seeing resident memory rise from 92 to 410 MB on the 200-page x 400 KB
  crawl I suspected the crawler held every body until the end and "fixed" it. Measuring with a forced GC showed the **live heap
  after the crawl is only 13 to 15 MB, and peak Buffer memory is the same (about 125 MB) with and without the change**: the rise is
  uncollected garbage, not retention. The change was reverted. For the record, the worst case (200 pages at 400 KB) peaks near
  370 MB resident and falls back after garbage collection.
- Observation: robots.txt and the sitemap are requested twice per cold crawl (the crawler's own, and the existing sitemap
  discovery's), as the design accepted.
