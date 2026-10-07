# SEO Audits Engine: Review of Phases 0 to 15 (corrected and brought up to date)

**Date**: 2026-10-06, at `main` = `16ab82d`
**Repository**: `lighthouse-ci` (fork), package `packages/seo-audits`
**Scope**: all 99 audits, the gatherers, the versioned rule engine, the site crawler, the tests, the security work and the documentation, Phases 0 to 15.

> **About this file.** The first version of this review was written by another agent. It was checked against the code and the live suite, and **this version replaces it**. What was wrong
> in the first version: the totals (it said 100 audits and 1,949 tests), "7 audits" for Phase 1 (there are 11), "weight 0" for informational audits (every audit is registered at weight 1;
> informational ones use `scoreDisplayMode: informative`), the claim that `placeholder-content` fails on `TODO:` (it does not), the claim that hreflang validates ISO 15924 scripts (any four
> letters passed; it now checks them against the runtime's locale data), a pending-checks list that still showed finished work, and a description of every phase as it was *before* the
> calibration of 2026-10-06. For the detailed audit-by-audit findings and the reasoning behind each change, the longer review file it summarised was removed on 2026-10-06 once its findings were fixed; they are in the git history and in `docs/phases/`.

---

## 1. Executive summary

| Metric | Value | Note |
| :--- | :--- | :--- |
| Audits in `seo-extended` | **99** | **57 scored** (7 of them a warning: score 0.5, weight 0.5) and **42 informational** (never scored) |
| Gatherers | 18 files in `src/gatherers/` | DOM extraction runs in the page; network probes are bounded |
| Tests | **112 suites, 1,989 tests, all passing** | on Node 24 and on Node 18.20.8 (the CI pin), 2026-10-06 |
| Typecheck, lint, prettier | clean | |
| Rule engine | 6 versioned ruleset families, schema-validated | Google requirements, eligibility, type conflicts, schema.org, deprecations, SERP pixel budgets |
| Security | no open finding | Findings 1 to 10 fixed; one accepted risk (`LHCI_SEO_ALLOW_PRIVATE_NETWORK`) |
| Real-site check | 5 real sites, 2026-10-06 | MDN, BBC News, apple.com, ikea.com, Wikipedia: six false positives found and fixed |
| Recommended assertions | `src/recommended-assertions.json` | error tier at `error`, warn tier at `warn`; a test keeps it in step with the audits |

The fork turns Lighthouse's SEO checks into a multi-phase engine: page metadata, structured data, social tags, robots and sitemaps, crawlability, indexability, a site crawler
(duplicates, internal linking), URL quality, images, international SEO, JavaScript rendering, performance-for-SEO, content quality and AI search.

### How the tiers work (since the calibration of 2026-10-06)

| Tier | Meaning | Mechanism |
| :--- | :--- | :--- |
| **Error** | objectively broken or contradictory, and documented by Google | score 0 or 1, weight 1 |
| **Warn** | best practice with real but moderate impact | score 0.5, weight 0.5 |
| **Informational** | advice, a heuristic or a report | `scoreDisplayMode: informative`; lhci cannot assert on it |

---

## 2. Phase by phase

Counts are audits in `seo-extended`; the tier of each audit is the one in force now.

### Phase 0: Baseline (no audits)
Mapped what Lighthouse core already covers (`document-title`, `meta-description`, `hreflang`, `canonical`, `robots-txt`, `viewport`, and others) so nothing was duplicated by accident. Where an
audit deliberately sits beside a core one it is meant to say what it adds.

### Phase 1: Page-level metadata (11 audits)
- **Scored:** `document-title-quality` (generic, placeholder, under 3 characters or several document `<title>`s; an inline SVG's `<title>` is not counted), `robots-directives-conflict`, `canonical-https`.
- **Warn:** `document-h1-count` (no `<h1>` warns; several are a note, as Google says they are fine).
- **Informational:** `pixel-width-truncation`, `meta-description-identical-to-title`, `h1-title-relevance`, `robots-directives-report`, `favicon-presence`, `favicon-quality`, `manifest-icons`.
- Strength: real in-browser pixel-width measurement of the title and description (the `PixelWidth` gatherer).

### Phase 2: Structured data (5 audits and the rule engine)
- **Scored:** `structured-data-json-ld` (invalid JSON or missing `@context`/`@type`; a page with no JSON-LD is not applicable), `structured-data-schema-properties`, `structured-data-type-conflicts`.
- **Informational:** `structured-data-rich-result-eligibility`, `structured-data-deprecated-properties`.
- Strengths: 12 schema types as versioned data; `@graph` unwrapping and one-level `@id` resolution; datatype checks (number, date, currency).
- Calibrated on 2026-10-06 against Google's live documentation: only properties Google **requires** fail (Article and Organization have none; a Product needs a name plus offers, review or
  aggregateRating; a Recipe needs name and image); recommended ones are notes. `BreadcrumbList` may appear more than once. The FAQ and HowTo eligibility text carries Google's nuance.

### Phase 3: Social and sharing tags (5 audits)
- **Scored:** `open-graph-completeness` (needs only `og:title` and `og:image`; `og:*` written with `name=` is read too), `open-graph-canonical-match` (a trailing slash or query-string difference is a note), `open-graph-image-reachable`, `twitter-card-completeness` (a missing `twitter:card` is a note).
- **Informational:** `social-preview-content`.
- Strength: an SSRF-protected status probe for `og:image`; no invented pixel threshold for the image.

### Phase 4: robots.txt and XML sitemaps (10 audits)
- **Scored:** `robots-txt-crawler-access`, `sitemap-valid` (a timeout or bot protection on a sitemap is a note), `sitemap-limits`, `sitemap-url-status`, `sitemap-robots-crossref`, `sitemap-indexability`.
- **Informational:** `robots-txt-sitemap-declared`, `robots-txt-rule-conflicts`, `sitemap-duplicate-urls`, `llms-txt-structure` (llms.txt is an unratified proposal).
- Strengths: one shared `SitemapDocuments` gatherer with single-pass `saxes` parsing, gzip and index recursion; hardened against IPv6 SSRF bypasses and quadratic XML; bounded URL sampling (10 to 25).

### Phase 5: Crawlability and status (7 audits)
- **Scored:** `mixed-content`, `ssl-certificate-expiry` (tiered: 0.5 within 15 days, 0 expired), `soft-not-found`, `url-variant-consistency` (a chain ending in 401, 403, 429 or 5xx is a note), `redirect-loop`.
- **Warn:** `redirect-chain-length` (more than 2 hops warns; it fails only at the hop limit).
- **Informational:** `hsts-quality` (a security header, not a search signal).
- Strength: probes the http, https, www and bare forms of the URL with chain and loop detection.

### Phase 6: Indexability (2 audits)
- **Scored:** `indexability-conflicts` (contradictory signals, such as noindex hidden behind robots.txt or a canonical pointing at a 4xx). **Informational:** `indexability-verdict`.

### Phase 7: Site-wide duplicates and consistency (6 audits and the crawler core)
- **Scored:** `duplicate-titles` (pairs that are canonicalised elsewhere or in one `rel=next` series are skipped), `canonical-conflicts`, `duplicate-content` (exact hashes, canonical-aware, 50-word floor).
- **Informational:** `crawl-coverage`, `duplicate-descriptions`, `thin-content` (Google has no word-count rule; utility pages are legitimately short).
- Strength: the `SiteCrawl` gatherer with an on-disk cache shared by every URL and run of one collect (one crawl per site, not per run).

### Phase 8: Internal linking and the site graph (13 audits and crawler v2)
- **Scored:** `dead-end-pages`, `orphan-pages` (judged only on a complete crawl), `broken-internal-links` (401, 403 and 429 are not judged), `paginated-canonical`, `broken-external-links` (404, 410, DNS and refused connections only).
- **Warn:** `redirecting-internal-links`, `internal-redirect-chains` (a loop still fails), `descriptive-anchor-text`.
- **Informational:** `internal-link-counts`, `crawl-depth`, `anchor-text-diversity`, `pagination-links`, `pagination-trap`.
- Strengths: breadth-first crawl to depth 3 from the homepage; anchor text with site-wide navigation filtered out; bounded external link checks (20 links, 2 per host, public-only fetch).

### Phase 9: URL quality (7 audits)
- **Scored:** `url-length` (a note above 115 characters, a failure only above 2,000), `url-session-tracking`, `url-encoding`, `url-case-variants`, `url-trailing-slash-variants`.
- **Informational:** `url-query-parameters` (an invented limit of 3), `url-normalization` (so a case twin is not counted twice).

### Phase 10: Images (7 audits)
- **Scored:** `image-alt-quality` (a file name or placeholder as alt; a 125-character alt and the same alt on 3 images are notes), `image-lazy-above-fold` (the horizontal position is tested too, so a carousel slide off to the side is fine), `image-dimensions-attributes` (accepts CSS sizes and aspect-ratio, the core rule), `image-oversized` (more than 3.5x, and an image from another site is a note), `broken-images` (a failing image from another site is a note).
- **Informational:** `image-filename-quality`, `image-legacy-formats`.

### Phase 11: International SEO, hreflang (7 audits)
- **Scored:** `hreflang-codes`, `hreflang-return-links`, `hreflang-alternate-status`, `hreflang-canonical`.
- **Informational:** `hreflang-x-default`, `hreflang-sitemap-consistency`, `hreflang-locale-meta`.
- Codes are validated with the runtime's own locale data (`Intl.DisplayNames`): language, region and (since 2026-10-06) script; `es-419` style UN M.49 regions; `en-UK` suggests `en-GB`; a
  three-letter code with a two-letter form is refused with the suggestion, one without (`fil`, `yue`) is accepted as Lighthouse core does.
- The audited page's own self-reference ignores tracking parameters. `x-default` is exempt from the return-link check and a redirect on it is a note. Up to 10 alternates are requested (128 KiB
  each, public-only fetch across origins, 20 s in all). Alternates whose tags are not in their HTML (headers or the sitemap) are notes.

### Phase 12: JavaScript SEO and rendering parity (7 audits)
- **Scored:** `js-head-signals` (fails only when JavaScript changes the noindex or two different canonicals exist; a title set by script is a note, because Google renders JavaScript), `hydration-errors`, `device-content-parity` (title, description, canonical, noindex and a large word gap; missing mobile links are a note).
- **Warn:** `js-internal-links` (more than 20% of links only after JavaScript), `js-visible-content` (more than half the words only after JavaScript).
- **Informational:** `raw-rendered-diff`, `rendering-mode`.

### Phase 13: Performance and SEO crossover (3 audits)
- **Scored:** `core-web-vitals-field` (real-user LCP, INP and CLS from CrUX at the 75th percentile, only with `LHCI_SEO_CRUX_API_KEY`; fails only when the URL's own result is poor; a poor
  site-wide fallback result is a note; not applicable without a key).
- **Informational:** `render-blocking-report`, `request-weight-report`.

### Phase 14: Content quality (5 audits)
- **Scored:** `placeholder-content` (lorem ipsum, template prompts such as "your text here", unfilled `{{ }}` or `<% %>` tags; code samples are skipped; **it does not look for `TODO:`**), `content-dates` (a modified date before the published date, a date in the future, or two different dates in the page's main entity; `<meta name="date">` is shown, not judged).
- **Informational:** `readability-score` (English only), `hidden-text` (carousel slides clipped by their container are not counted), `keyword-alignment`.

### Phase 15: AI search (4 audits, all informational)
- `ai-crawler-summary` (18 crawlers and tokens, each checked against its vendor's own page; the user-initiated fetchers `ChatGPT-User` and `Perplexity-User` may ignore robots.txt, and the table says so), `answer-structure`, `author-entity-signals`, `amp-check`.
- Informational because there is no official rule for this area and blocking an AI crawler is a legitimate choice.

---

## 3. Strictness, overengineering and false positives

### What the first version of this section proposed, and what happened
| Suggestion | Outcome |
| :--- | :--- |
| Relax `url-length` (115 characters) | Done: a note above 115, a failure only above 2,000 characters |
| Make the query-parameter count a note | Done: `url-query-parameters` is informational |
| Give `thin-content` tolerance for utility pages | Done more strongly: `thin-content` is informational (Google has no word-count rule) |

### What the calibration changed overall
- **19 audits** moved from scored to informational; **7** became a warning (score 0.5).
- Six false positives in Phases 11, 13 and 14 were found by running the real builders and fixed (`x-default`, tracking parameters, Article plus Review dates, code samples, whole-site CrUX, three-letter language codes).
- Six more were found by running on five real sites and fixed (a page with no JSON-LD failing, SVG titles, a 403 on a probe, sitemap timeouts, 3x image assets, `og:*` tags written with `name=`).
- The principle held throughout: **a scored failure needs an objective defect that Google documents**; heuristics and conventions are informational or a warning.

### Kept on purpose
Hard failures remain for broken or contradictory things: invalid JSON-LD, conflicting indexability signals, a noindex page in the sitemap, broken external links (404 and 410 only), redirect loops,
session IDs in URLs, case and trailing-slash twins, hydration errors.

---

## 4. Still open (details in `docs/open-items.md`)

- **A3:** a real GitHub Actions run with the fork config (yours); it settles the runner's egress, the cost of a cold crawl and the per-run request budget.
- **E:** `core-web-vitals-field` has never seen real CrUX data (needs a Google API key).
- **Real-site checks:** a multilingual site with an `x-default` chooser, a retail carousel, an Article plus Review, a Next/React/Angular site, template and real-prose pages.
- Housekeeping: the stale `docs/phases/phase-1-page-metadata.md`, and the failing suites in packages other than `seo-audits`.

---

## 5. Conclusion

The engine is in good shape, and **better calibrated than the first version of this review could say**: its weakest point was always false positives, not missing checks, and that is what the
2026-10-06 calibration addressed. What it cannot yet claim: real-world behaviour beyond five sites, the success path of the CrUX audit, and a run on a real CI runner.
