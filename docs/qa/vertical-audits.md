# QA: the vertical audits (Phase 18)

Design and decisions: `docs/phases/phase-18-vertical-audits.md`. Checked on 2026-10-06 and 2026-10-07 on Node 24 (the unit suites also on Node 18.20.8). Every group was run through a real `lhci collect` with `packages/seo-audits/src/lighthouse-config.js`, on real pages where one exists and on a small purpose-built site where a defect had to be planted to prove the positive path. The purpose-built sites were throwaway Node servers started on localhost with `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`; to repeat a check, serve a page with the markup the audit's description names and read the audit in the report.

## What was checked, group by group

| Group | Real sites | Purpose-built site | Result |
|---|---|---|---|
| Security headers | github.com (all present), web.dev (`nosniff`, no Referrer-Policy: a note), example.com (no `nosniff`: 0.5) | not needed | as designed |
| E-commerce | IKEA product page (all pass; the crawl audits decline honestly on a partial crawl and a sitemap too big to read), Allbirds (pointer variants wrongly flagged at first: fixed; JSON-LD past 512 KiB missed: crawler cap raised), Etsy refuses headless Chrome | an invalid `$1,299.00` price, a bad GTIN check digit, 24 facet combinations, an unlisted and an unlinked product, a two-product category | every audit gave the expected result |
| Local business | not run on a real local business | one `@id` with two phone numbers, a renamed copy, a legitimate second location, coarse geo, an invalid weekday and time, a page missing from the sitemap | every defect reported; the second location was not flagged |
| News | the real New York Times news sitemap (637 entries: valid with `en-US` notes; the late entry among 637 is not judged), the Guardian (its declared `http://` sitemap redirects: the audits say a file could not be read) | flawed `NewsArticle` markup and a mixed news sitemap | every defect reported |
| Video | a real New York Times video sitemap file (93 videos, no problem reported) | an unmarked YouTube embed, a video with bad markup, a dead same-site thumbnail next to a live cross-site one, a decorative background video, a sitemap with four defects | every result as designed |
| Entity | Wikipedia answered the probe with 403 and LinkedIn with 999 (both only notes), a real dead GitHub profile gave a 404 (a defect) | a missing scheme, a non-public address, a name and logo that differ between pages, a person page | every defect reported |

## Defects the checks found (all fixed, each with a test)

See the table in the design doc. The most important: the thumbnail and `sameAs` probes first reached internal addresses (a local service answered); this is recorded in `.ai-agents/state/security-findings.md` and covered by regression tests for ten address spellings.

## Not verified (needs you)

1. **A real shop with a complete crawl.** `product-pages-in-sitemap` and `product-category-linking` only judge when the crawl saw the whole site and the sitemap was read in full; on the large shops tried they declined (correctly). Run them on your own shop.
2. **A real multi-location business site** for the two local consistency audits.
3. **A real publisher's article page together with its own news sitemap** (the sitemap and the article were checked separately).
4. **A real video watch page** for `video-discoverability` and `video-thumbnail-reachable` (the Guardian's and the New York Times' video sitemaps are large indexes the gatherer's 10-file budget does not reach).

## Known limits

- Product, local business, article, video and entity markup is read from **JSON-LD only** (not Microdata or RDFa), except that Microdata `VideoObject` counts as video markup.
- The crawler skips query-string variants as unread, so on a shop with faceted navigation the crawl is incomplete and `product-category-linking` declines; `faceted-navigation-explosion` reports that trap.
- The sitemap gatherer does not follow a redirect (a declared `http://` address that redirects to https is not read) and reads at most 10 files; the audits say so instead of claiming a sitemap does not exist.
- Consistency checks (NAP, names, identity) are our judgement, not Google requirements.
