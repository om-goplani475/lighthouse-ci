# Phase 18: vertical audits (security headers, e-commerce, local, news, video, entity)

**Status: Done. Merged into `main` (2026-10-07, `--ff-only`); the branch is deleted.** Branch `phase-18-vertical-audits`. Build mode: full pipeline per vertical, one approval per vertical (agreed 2026-10-06). Decisions taken with the developer: all six verticals in one branch; the crawl snapshot is extended so cross-page checks are possible; monitoring, reporting, template detection and AI-generated fixes are **not** part of this branch (they are product features that need design: storage, a scheduler, an LLM key).

## Rules for every audit here

- **Not applicable, not noisy.** A vertical audit says "not applicable" (score 1, `notApplicable`) on a page that is not that kind of page (no `Product` markup, no local business, no video). A site must never be told its blog lacks a product GTIN.
- **Tiers** (as in the rest of the package): a definite defect that makes Google ignore the data is the error tier (score 0); advice is the warn tier (score 0.5, weight 0.5, recommended severity `warn`); inventories and reports are informational. Nothing here is error tier unless Google's own documentation says the markup is unusable.
- **Thin audit over a pure `lib/` builder**, static fixture tests, no live URLs in tests, no new request surface without the SSRF-protected helpers (`safe-fetch`, public addresses only).
- **Each audit id** avoids a hyphen followed by a digit (an lhci assert alias bug). Every audit appears exactly once in `summary/categories.js` and, if scored, once in `recommended-assertions.json`.
- **Sources** are Google's documentation as read on 2026-10-06; where a rule is our judgement and not Google's, the audit says so.

## Shared infrastructure (built with the first vertical that needs it)

- `lib/structured-facts.js`: one projection of JSON-LD into small, bounded "facts" (`type`, `id`, `name`, and a whitelist of properties per family: identity, address, phone, hours, geo, product offers and identifiers, `sameAs`). Used by the in-page audits (from the `StructuredDataJsonLd` artifact) and by the crawler, so both see the same thing. `@type` may be a string or a list.
- **Crawl snapshot v3**: each crawled page also records its `entities` (the projection above, at most 10 per page and bounded in size). The version is part of the cache key, so an old cache is simply not used.

## The audits

### A. Security headers (3, informational or warn tier; main document only, no new request)

Read from the main document's response headers Lighthouse already has.

| Audit | Rule | Source / basis |
|---|---|---|
| `x-content-type-options` | warn when the header is missing or its first value is not `nosniff` | MDN `X-Content-Type-Options`; our judgement that it is an SEO-adjacent hygiene signal |
| `referrer-policy` | warn when missing, or `unsafe-url` / `no-referrer-when-downgrade` | MDN `Referrer-Policy`; judgement |
| `content-security-policy-report` | informational: present or absent, whether it has `frame-ancestors`, `unsafe-inline` or `unsafe-eval` | MDN CSP; Lighthouse core's `csp-xss` is informational too |

### B. E-commerce (6)

| Audit | Level | Rule | Source |
|---|---|---|---|
| `product-identifiers` | warn | a `Product` should carry a `gtin*`, `mpn` or `sku`, and a `brand`; GTINs must be digits; `sku` must not contain whitespace | Google merchant listing |
| `product-offer-values` | error for an invalid value, otherwise warn | `price` numeric with no currency symbol and greater than zero; `priceCurrency` a three-letter ISO 4217 code; `availability` one of the documented ItemAvailability values, only one; `itemCondition` one of the three documented | Google merchant listing |
| `product-variants` | warn | a page with several `Product` offers/variants should use `ProductGroup` with `productGroupID`, `variesBy` and `hasVariant`; each variant needs a unique `sku` or `gtin` | Google product variants |
| `faceted-navigation-explosion` | warn (crawl) | one path linked with many distinct query-parameter combinations (a crawl trap); reports the path and parameter names | judgement; reads the crawl links |
| `product-pages-in-sitemap` | warn (crawl) | crawled `Product` pages that no sitemap lists | judgement |
| `product-category-linking` | warn (crawl, complete crawls only) | a `Product` page that no listing page links to (a listing page is a crawled page linking to at least 3 product pages) | judgement; as `orphan-pages`, not judged on an incomplete crawl |

### C. Local (5)

| Audit | Level | Rule | Source |
|---|---|---|---|
| `local-business-values` | warn | telephone has a country code and 7 to 15 digits; `geo` in range with at least 5 decimals; `openingHoursSpecification` days valid, `opens`/`closes` as `hh:mm`(`:ss`); `priceRange` under 100 characters; address has street, locality, region or country | Google local business |
| `local-nap-consistency` | warn (crawl) | the same business (same `@id`, else same name) shown with different telephone or address on different pages | judgement |
| `local-name-consistency` | warn (crawl) | the same `@id` with different names, or the business name written differently across pages | judgement |
| `local-pages-report` | informational (crawl) | pages that carry a local business, with their address | inventory |
| `local-pages-in-sitemap` | warn (crawl) | crawled local-business pages that no sitemap lists | judgement |

### D. News (4)

| Audit | Level | Rule | Source |
|---|---|---|---|
| `article-values` | warn | Article family: ISO 8601 dates and `dateModified` not before `datePublished`; authors one each, Person or Organization, name only; paywall markup with a `.class` selector. A headline over 110 characters is a note (**ours**: Google gives no limit) | Google article markup and paywalled content |
| `news-sitemap-valid` | error for a missing required tag, otherwise warn | `news:news` (at most 1,000 per sitemap) with `news:publication` (`name`, `language`), `news:publication_date` in an accepted date form, `news:title` | Google News sitemap |
| `news-sitemap-freshness` | warn | entries older than two days | Google News sitemap |
| `news-sitemap-report` | informational | how many news entries, the newest and oldest dates | inventory |

### E. Video (4)

| Audit | Level | Rule | Source |
|---|---|---|---|
| `video-structured-data-values` | warn | `VideoObject`: `uploadDate` ISO 8601 (timezone recommended), `duration` ISO 8601, `contentUrl` or `embedUrl` a valid URL, unique `name` and `description` | Google video |
| `video-sitemap-valid` | error for a missing required tag, otherwise warn | `thumbnail_loc`, `title`, `description` (at most 2,048 characters), `content_loc` or `player_loc`; `duration` 1 to 28,800; `rating` 0.0 to 5.0; at most 32 tags; the video URL must not equal the page `loc` | Google video sitemap |
| `video-discoverability` | warn | the page embeds a video (`<video>` or a YouTube/Vimeo iframe) but has no `VideoObject` markup | judgement; Google: videos belong on a page where they can be watched |
| `video-thumbnail-reachable` | warn | the `thumbnailUrl` answers (bounded, public addresses only, as `open-graph-image-reachable`) | Google: the thumbnail must be crawlable |

### F. Entity and knowledge graph (4)

| Audit | Level | Rule | Source |
|---|---|---|---|
| `entity-same-as-values` | warn | `sameAs` entries must be absolute https URLs, not the page itself, without duplicates | Google organization |
| `entity-same-as-reachable` | warn (network, bounded) | up to 8 `sameAs` URLs answer (a 404 or 410 is a defect; bot protection is a note, as elsewhere) | judgement |
| `entity-identity-consistency` | warn (crawl) | the same organization or person `@id` with different names, logos or `sameAs` sets across pages | judgement |
| `entity-disambiguation` | informational | which identity signals an organization or person has: `@id`, `url`, `logo`, `sameAs`, and an identifier (`iso6523Code`, `leiCode`, `duns`, `naics`) | Google organization (these are all recommended, none required) |

## Status

- **A. Security headers: built** (3 audits, 16 unit tests, checked live on github.com, web.dev and example.com). A missing `Referrer-Policy` is not faulted (browsers already default to `strict-origin-when-cross-origin`); only `unsafe-url` is. The config test no longer lists every audit id by hand: it derives the list from `summary/categories.js`, the single source of truth.
- **B. E-commerce: built** (6 audits, 42 + 9 + 9 unit tests, shared infrastructure). Built with it: `lib/structured-facts.js`, JSON-LD capture in the crawler, snapshot version 3, and the crawler's body cap raised from 512 KiB to 2 MiB. Live checks found and fixed three real problems: the crawler missed JSON-LD past byte 512 KiB (Allbirds: byte 824,767), variants written as bare pointers were wrongly flagged, and the crawl audits said "no product pages" when the crawler had simply been refused (403) on the audited page. A purpose-built shop with known defects proved every audit's positive path. The category threshold is 3 product links (not 5): a real "Boots" category with 2 products was wrongly seen as unlinked at 5.
- **C. Local: built** (5 audits, 23 unit tests, checked live on a purpose-built site). Shared helpers for the cross-page audits moved to `lib/vertical-common.js`. The unit tests found that national phone numbers with a leading trunk `0` (`020 7946 0958`) did not match their international form (`+44 20 7946 0958`): fixed, since it would have reported false inconsistencies for most non-US businesses. A `local` preset was added.
- **D. News: built** (4 audits, 23 + 6 + 2 unit tests, checked live on a purpose-built publisher and on the real New York Times news sitemap). Corrections found on the way: **Google documents no 110-character headline limit** (my design cited one from memory; it is now a labelled note of ours), and it documents no NewsArticle-only fields, so `news-article-values` became `article-values` covering the whole article family. The sitemap parser now reads the news and video extensions. Real data showed that a major publisher writes `news:language` as `en-US`, which first scored 0: now a note. `count()` pluralised "entry" as "entrys": fixed. When a declared sitemap could not be read (the Guardian's `http://` address redirects), the audits now say so instead of "no news sitemap". A `news` preset was added.
- **E. Video: built** (4 audits, 24 unit tests, checked live on a purpose-built site and on a real 93-video New York Times sitemap file: no false positives). The thumbnail probe reuses the SSRF-protected status helpers (first-party thumbnails use the page's lookup; thumbnails on other sites are public-only) and the package's probe-refusal policy (only 404/410/missing host are defects). The ISO date parser moved to `vertical-common.js`; `siteOf` is now exported from `images.js`. A `video` preset was added.
- **F. Entity: built** (4 audits, 20 unit tests, checked live on a purpose-built site and real addresses). The shared bounded status probe moved to `vertical-common.js` (`probeStatuses`, used by video and entity); `normalizeName` moved there too. **A security defect was found in this slice by testing and fixed before the branch was merged** (see below). New environment variable `LHCI_SEO_SAMEAS_MAX_CHECKS` (default 8, 0 to 20).

## Status of the branch

All six verticals are built and committed: **26 new audits** (125 in all: 79 scored, 31 of them error tier and 48 warn tier, and 46 informational), the shared structured-facts projection, the crawl snapshot v3, the news and video sitemap extension parsing, and the `ecommerce`, `local`, `news` and `video` presets. Not part of this branch, as agreed: monitoring (scheduled crawl diffs), reporting (exports, history), template detection and AI-generated fixes.

### Defects found by live checks and tests, all fixed in the branch

| Found by | Defect |
|---|---|
| a real product page (Allbirds) | the crawler read only 512 KiB, so JSON-LD at byte 824,767 was missed: cap raised to 2 MiB |
| a real product page (Allbirds) | variants written as bare pointers were flagged: pointers are no longer judged |
| a real shop that refused the crawler (403) | "no product pages" was claimed: the audits now say why the audited page could not be used |
| a real small category (2 products) | a category threshold of 5 product links was too high: now 3 |
| a unit test | national phone numbers with a trunk `0` did not match their international form |
| the real New York Times news sitemap | `news:language` `en-US` scored an error: now a note |
| the real New York Times news sitemap | one late entry among 637 warned: now only from a tenth of the entries |
| the real Guardian | a declared `http://` sitemap that redirects was reported as "no news sitemap": the audits now say a file could not be read |
| unit tests | `count()` pluralised "entry" as "entrys" and "address" as "addresss" |
| a test of the probe against internal addresses | **security: the thumbnail and `sameAs` probes reached `127.0.0.1` and tried `10.x` and `169.254.169.254`** (see `security-findings.md`): `safeFetchPublicStatus` added, the audits use it, with regression tests | Each vertical is built, QA'd against a real site, documented here, and committed after one approval.
