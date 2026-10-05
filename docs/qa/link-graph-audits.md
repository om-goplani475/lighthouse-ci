# QA checklist: Link-graph audits (Phase 8 items 1 and 2)

- audits: `dead-end-pages`, `internal-link-counts`, `orphan-pages`, `crawl-depth`
- build mode: lightweight, after a short design conversation (thresholds chosen with the developer); no new request, no new gatherer
- branch: `feat/link-graph-audits`, off `phase-8-internal-linking`

All four read the crawl snapshot built by item 0 (`docs/qa/link-graph-crawler.md`). Checked with real Lighthouse runs against a planted site that the crawler
can read completely (with `LHCI_SEO_CRAWL_MAX_PAGES=200` and `LHCI_SEO_CRAWL_MAX_DEPTH=6`) and again with the defaults.

## Functional (complete crawl)

| Audited page | `dead-end-pages` | `internal-link-counts` | `orphan-pages` | `crawl-depth` |
|---|---|---|---|---|
| `/orph` (only in the sitemap, nothing links to it) | pass | pass (0 in is `orphan-pages`' job) | **fail** | n/a (no path from the homepage) |
| `/dead` (links to nothing) | **fail** | **fail** (1 page links in) | pass | pass (1 click) |
| `/a4` (a chain: 5 clicks from the homepage) | pass | **fail** (1 in) | pass | **fail** (5 clicks) |
| `/hub` (160 links to leaf pages) | pass | **fail** (160 out) | pass | pass |
| `/b` (linked from the homepage only) | pass | **fail** (1 in) | pass | pass |
| `/` (the homepage) | pass | pass | n/a (the homepage is not judged) | pass ("The homepage") |

- [x] **Partial crawl (defaults: 50 pages, depth 3; the hub makes the site bigger than the cap)**: `orphan-pages` is not applicable and names the limit that stopped it
      ("more pages were found than the page cap; ..."), `internal-link-counts` shows `0+ in` and does not judge the low side, `crawl-depth` for a page it cannot
      place says "so one may exist" (reworded after this check, with a test).
- [x] **Unit tests**: the graph library (16) and the four builders (64), covering the thresholds at and one past the limit, nofollow and self links, links through a
      redirected URL, links to pages the crawl did not reach, every reason a crawl is partial, the homepage exemptions, the not-applicable cases (script-built page,
      unreadable audited page, missing or disabled crawl), row caps, and that nothing throws on malformed input. 75+ suites pass, typecheck and lint clean.

## Safety and cost (no new request)

- [x] **Time on hostile snapshots** (200 pages): every page linking to all 199 others, with 1,900-character URLs: worst **0.37 s** for the first builder in a process
      (about 25 ms for the rest), after a fix (it was 1.7 s: links were normalised several times; targets are now computed once per page); a 200-page chain and
      a star: under 4 ms. Output at most 15 KiB (rows capped at 50, cells clipped to 200 characters).
- [x] **Page-controlled text** appears only in table cells, clipped; never in a title, score or id.

## Findings

- With the defaults, `orphan-pages` is not applicable on any site that the crawl cannot read completely (more than about 50 pages). This is by design (never a wrong orphan)
  and stated in the README and the tracker.
- One wording bug found by the live partial-crawl check (above), fixed.

## Not verified

- The audits on a real public site, and in the viewer (the details tables), a real GitHub Actions run (see `docs/open-items.md`).
- Node 18.20.8 re-run of the new suites.
