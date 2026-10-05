# QA checklist: Anchor-text audits (Phase 8 item 4)

- audits: `anchor-text-diversity`, `descriptive-anchor-text`; also an extractor change (anchor text falls back to image alt, then `aria-label` or `title`)
- build mode: lightweight, after a design conversation; no new request, no new gatherer
- branch: `feat/anchor-text-audits`, off `phase-8-internal-linking`

## Functional (real Lighthouse runs against a planted site)

- [x] **`descriptive-anchor-text`** (audited `/t`: "click here", "Read more", an icon with no label, an icon with `aria-label="Open the cart"`, and a good "Our pricing"): fails with
      **3** weak links; the `aria-label` link and the descriptive one are not flagged. A page with only descriptive anchors passes ("Every internal link on the page describes its
      target"), listing another crawled page's weak links as information.
- [x] **`anchor-text-diversity`**: with a menu (`Home`, `Shop`, `Guides`) on every page and 5 crawled pages linking to `/t` as "red running shoes": **fails** ("Top anchor ... is 100% of
      5 links"), with the 7 navigation links named as left out. A page with one editorial link passes as "too few to judge".
- [x] **Unit tests**: 40 for the two builders (boundaries at exactly 60% and 59%, fewer than 5 links, case and punctuation, navigation exclusion, the half-the-site regression, empty
      anchors, self links, links through a redirected URL, the homepage, other pages listed and capped, singular wording) plus 1 for the extractor fallback.

## Safety and cost (no new request)

- [x] **Time on hostile snapshots** (200 pages x 200 links, 100-character anchors, every page linking to every other): worst **246 ms**, output at most 6 KiB (rows capped at 50, cells at 200).

## Findings

- **My first navigation rule was wrong (fixed, with a test).** I treated a link on at least half the crawled pages as site-wide navigation. The live run then excluded 8 contextual links
  "red running shoes" on a 15-page site, so the audit missed exactly the pattern it exists to catch. Navigation is now at least 80% of the crawled pages.
- **A sample, not the whole site**: the audit counts the crawled pages' links only; on a partial crawl the share is among those, and the explanation says "counted among the crawled pages only".

## Not verified

- A real public site; the viewer; a real GitHub Actions run; the Node 18.20.8 re-run (see `docs/open-items.md`).
