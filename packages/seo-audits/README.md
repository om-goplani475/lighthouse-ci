# @lhci/seo-audits

Custom Lighthouse audits added by this fork, kept as their own package so upstream
(`google/lighthouse-ci`) merges stay clean — see `../../CLAUDE.md` and `../../AGENTS.md` for the full
rationale and the agent pipeline this package was built through.

## What's in here

- **`structured-data-json-ld`** — validates every `<script type="application/ld+json">` block on a
  page: it must be parseable JSON and include `@context`/`@type`, **or be a valid `@graph`
  container** (`@context` plus a non-empty `@graph` array whose entries each have their own
  `@type`) — see "`@graph` and `@id` reference support" below. Lighthouse's own built-in
  `structured-data` audit is a manual placeholder (it just tells you to run an external tool); this
  one actually checks it. See `docs/feature-specs/structured-data-validation.md` in the repo root for
  the full spec and rationale.
- **`structured-data-schema-properties`** — for JSON-LD blocks whose `@type` is one of the 12 types
  Google documents rich-result guidance for (`Product`, `Article`, `BreadcrumbList`, `Recipe`,
  `Review`, `Event`, `JobPosting`, `VideoObject`, `Organization`, `LocalBusiness`, `FAQPage`, `HowTo`),
  checks that Google's required/recommended properties are present, including specific nested
  sub-object properties (e.g. `Product.offers.price`, `Event.location.address`), **and, for a
  handful of properties where it's unambiguous, that a *present* property's value is well-formed**
  (Phase 2 item 4) — e.g. `Product.offers.price` parses as a number, `Product.offers.priceCurrency`
  is a 3-letter code shape, `Article.datePublished`/`Event.startDate`/`JobPosting.datePosted`/
  `VideoObject.uploadDate`/`Review.reviewRating.ratingValue` are ISO-8601-shaped. This is
  deliberately narrow, not a general-purpose schema-datatype validator: only properties with a
  `datatypes` entry in their `rules/google/structured-data/*.json` type rule are checked this way,
  and only when present at all — a missing property is still `required`'s concern, this only
  catches "present but obviously wrong" (e.g. `price: "free"`), findings are tagged with the same
  `google-requirements` namespace and drive the same score as a missing-property finding, no new
  namespace needed. Rule content lives as versioned data under `rules/`, not hardcoded in the audit
  — see `docs/architecture/structured-data-rule-engine.md` for why, `docs/feature-specs/structured-data-rule-engine.md`
  for the original two-type audit, and `docs/audit-specs/structured-data-remaining-types.md` for the
  per-type property lists behind the other 10. Tracking a new type is a `rules/` data change, not new
  audit code.

  Two known v1 limitations, documented so they don't get mistaken for bugs later:
  - **Nested checks are one level deep only.** `FAQPage.mainEntity[].acceptedAnswer` is verified for
    presence, but the engine doesn't recurse into `acceptedAnswer.text` itself — a two-level-deep
    check, which the rule engine doesn't support by design (it's not a generic recursive schema
    validator).
  - **`FAQPage`/`HowTo` are reported as eligibility-`false`, not hedged-`true`.** Google restricts both
    rich-result types to a narrow set of authoritative sites; the eligibility ruleset's schema only
    models a boolean `supported` flag, which can't express "restricted" — `false` is the closer
    approximation of the two, not a data-entry mistake.

### `@graph` and `@id` reference support (Phase 2 item 5)

All five structured-data audits (`structured-data-json-ld`, `structured-data-schema-properties`,
`structured-data-rich-result-eligibility`, `structured-data-type-conflicts`,
`structured-data-deprecated-properties`) understand
`{"@context": ..., "@graph": [...]}` containers — a standard JSON-LD pattern common real-world
emitters (Yoast SEO and others) use to declare several entities in one `<script>` block. Before
this, a `@graph` block was **wrongly flagged as invalid** by `structured-data-json-ld` (it has no
top-level `@type` by design — that used to trigger a false "Missing @type"), and every entity
inside one was **silently invisible** to the other three audits (each independently checked for a
top-level `@type` string and skipped anything without one). Both are fixed: `@graph` containers are
recognized as valid (checking `@context` at the container level and `@type` on each entry), and
every typed entity inside a `@graph` is unwrapped and checked exactly as if it were its own
top-level block.

Property values given as a bare `{"@id": "..."}` reference (rather than inlined) are also resolved
against sibling entities in the same `@graph` before nested-property/datatype checks run — e.g. a
`Product.offers` given as `{"@id": "#offer1"}` pointing at a separate `Offer` entity elsewhere in
the graph is resolved to that entity's real data, not read as a bare, property-less stub that would
otherwise fail every nested-required check. Resolution is **one level deep only** — a resolved
node's own `@id` references are not themselves chased, matching this codebase's existing "no deep
recursion" scope limit (see the nested-property-check limitation above). An unresolvable reference
(no matching `@id` anywhere in the graph) is left as-is, which naturally fails nested-required
checks the same way a genuinely missing property would — not a special-cased error path.

Shared logic lives in `src/lib/json-ld-graph.js` (`extractTypedEntities`), used by the three
type-consuming audits in place of each one's previous ad-hoc `@type` check; the validity check
itself (container vs. single-entity) lives in `src/rule-engine/schema-org-engine.js`.
- **`structured-data-rich-result-eligibility`** — a standalone, purely informational report: for
  every distinct schema type found in JSON-LD on the page, one row showing whether Google currently
  documents rich-result guidance for it and which feature if so, reusing the same `eligibility`
  ruleset data `structured-data-schema-properties` already uses (see Finding namespaces below).
  Distinct from that audit in two ways: it aggregates by type (a page with three `Product` blocks
  gets one row with `count: 3`, not three rows), and it does **not** skip untracked types — a
  `WebSite` or `Thing` block gets its own "not tracked" row, making this a complete inventory rather
  than a pass/fail check. `score` is always `null` (`scoreDisplayMode: informative`); the only
  not-applicable case is a page with zero parseable JSON-LD at all — a page whose JSON-LD is entirely
  untracked types still gets a full report, not `notApplicable`.
- **`structured-data-type-conflicts`** — two independent checks, with different severity:
  - **`duplicate-count`** (scored, can fail the audit): a schema type Google's guidance expects at
    most once per page — `Organization`, `WebSite`, `BreadcrumbList` in v1 — appears more than once.
    Low false-positive risk; counting is unambiguous.
  - **`conflicting-entity`** (informational only, never affects score): two or more blocks of the
    same type share a *strong identity field* (e.g. `Product.sku`/`gtin`/`mpn`, or `url` for several
    other types) but disagree on some other field's value. **Deliberately conservative**: a block
    with none of its type's listed identity fields is never compared for conflicts at all, even if
    every other field happens to match another block — this is a deliberate false-negative bias over
    a false-positive one, so this check will miss real conflicts it has no reliable signal for rather
    than risk flagging two legitimately different entities (e.g. two different products on a listing
    page) as a conflict. Not every tracked type has identity fields defined — `Review`, `FAQPage`,
    `HowTo` never get checked for conflicts at all; `BreadcrumbList` is checked for `duplicate-count`
    but *not* `conflicting-entity` — these are two genuinely separate lists in the ruleset, not one.
  - Not-applicable only when there are zero blocks of any singular type *and* zero blocks of any
    identity-field-bearing type — a page with everything correctly non-duplicated/non-conflicting
    scores 1, it isn't skipped.
- **`structured-data-deprecated-properties`** (Phase 2 item 6) — for the six schema types
  `structured-data-schema-properties` already validates most deeply (`Product`, `Article`, `Event`,
  `JobPosting`, `VideoObject`, `Review`), reports any property schema.org has superseded with a
  newer name (e.g. `Product.reviews` → `review`, `VideoObject.interactionCount` →
  `interactionStatistic`) sourced from schema.org's own published "Supersedes" notes on each type's
  page. Purely informational (`scoreDisplayMode: informative`, `score` always `null`) — a deprecated
  property usually still works and Google may still honor it, so this is a heads-up, not a validity
  check. Not-applicable only when none of the six types appear at all; a page using only current
  property names still gets a full report with zero rows, not `notApplicable`. Deliberately narrow
  in two ways, both explicit scope decisions rather than gaps: only the six types already covered
  elsewhere (not all twelve tracked types), and only each entity's own top-level properties (not
  nested sub-objects), matching this codebase's established "start narrow, expand on real signal"
  pattern — see the "To do later" table in `docs/phases/phase-2-structured-data.md`.
- **`pixel-width-truncation`** — flags when the page's `<title>` or meta description would likely be
  visually truncated in Google's search results, based on **real rendered pixel width** measured via
  an off-screen canvas in the page's own browser context (a new gatherer, `PixelWidth` — not a
  character-count approximation). Google truncates SERP snippets by pixel width, not character
  count, so two texts of the same length can truncate differently depending on which characters they
  contain. `score` is always `null` (`scoreDisplayMode: informative`) — see "A note on asserting
  informational audits" below for why, and read it before wiring this into CI. Not-applicable only
  when both title and description are absent from the page (a missing title/description is
  `document-title`'s/`missing-meta-description`'s concern, not this audit's); a single absent field
  is simply skipped, not treated as not-applicable.

  **The reference font/size and pixel budgets are an unverified approximation, stated plainly, not
  buried**: Google does not officially publish the exact font, size, or pixel budget it uses to
  render/truncate SERP snippets, and these are known to vary over time and by device. The values in
  `rules/serp-pixel-budgets/` are a widely-cited industry-SEO-tooling convention, not verified Google
  documentation — a materially weaker confidence basis than every other ruleset in this package (those
  at least approximate a *published* Google guideline; this approximates an *unpublished* rendering
  detail with no official source to check against at all). A flagged row means "may be truncated
  under this approximate model," never "will be truncated" or an unqualified "is too long" — the
  audit's own report messaging is written accordingly, and any consumer surfacing these results
  should keep that hedge.
- **`meta-description-identical-to-title`** — flags when the meta description is identical, or
  near-identical (e.g. the title plus a trailing site name, like `"My Page Title | My Site"`), to
  the page `<title>`. Reuses the `PixelWidth` gatherer's artifact (no new gatherer needed) for both
  text values. Unlike `pixel-width-truncation`, this **is** scored normally (`score: 0`/`1`) — no
  approximate-ruleset caveat applies here, either the two strings really are duplicated or they
  aren't. Not-applicable when either title or description is absent (same boundary as every other
  audit in this package: presence/absence is `document-title`'s/`missing-meta-description`'s
  concern, not this one's). "Near-identical" uses a length-ratio heuristic (the shorter of the two
  normalized strings must be at least half the longer one's length, and fully contained in it)
  rather than exact matching alone, so a description that merely opens with a few of the same
  words as the title before going on to say something substantively different isn't flagged.
- **`document-title-quality`** — beyond mere presence (already checked by core's `document-title`
  audit), flags three specific title problems: a **generic/placeholder title** matched against a
  fixed, hand-curated list of common template/CMS defaults (`"Untitled Document"`, `"New Page"`,
  `"Home"`, etc. — not a pattern match, so a real short title never gets flagged just for sharing a
  word with one of these); a **title too short** to be meaningful (under 10 characters after
  trimming — an arbitrary but conservative threshold, tuned to rarely fire on an intentional short
  title like a brand name alone); and **multiple `<title>` elements** (invalid — only the first is
  used by browsers/crawlers, per the HTML spec, and this is checked independently of the other two
  since it's a structural problem regardless of what the first title's text says). Reuses the
  `PixelWidth` gatherer, extended with a `titleElementCount` field (same DOM round-trip, not
  pixel-width-related itself — reading it needs the raw element count since `document.title` only
  ever reflects the first `<title>`). Scored normally; not-applicable only when title is absent
  *and* there's at most one `<title>` element (the empty/missing case is core's concern) — a page
  with zero title text but two empty `<title>` elements is still flagged for that structural
  problem.
- **`document-h1-count`** — flags when a page has zero or more than one `<h1>` element (with
  non-empty text). Scored normally. Deliberately narrow: heading *level order* (skipped levels)
  and *empty* headings are already covered by Lighthouse core's own `heading-order` and
  `empty-heading` accessibility audits (confirmed by reading axe-core's source before building
  this — same "check what's already covered" discipline as `missing-meta-description`), so this
  audit only covers count. Uses a new `Headings` gatherer (`h1Texts: string[]`, empty-text H1s
  filtered out at collection time since core's `empty-heading` already owns that concern).
- **`h1-title-relevance`** — a deliberately weak, purely informational heuristic: does each `<h1>`
  share at least one significant word (≥3 chars, common stopwords excluded) with the page
  `<title>`? No shared words is flagged as a row, but explicitly **not** treated as confirmed
  evidence of a problem — a genuinely relevant H1 can legitimately share zero words with its title
  (synonyms, rephrasing), so this is `scoreDisplayMode: informative`, never gates CI. Checks each
  `<h1>` independently when a page has more than one (which `document-h1-count` also flags as its
  own, separate structural issue). Not-applicable when there's no title or no H1 at all — nothing
  to compare.
- **`robots-directives-report`** — lists every directive found in `<meta name="robots">` and/or
  the `X-Robots-Tag` HTTP response header, each with a plain-English explanation of what it
  actually does (`noindex`, `nofollow`, `nosnippet`, `noarchive`, `max-snippet`,
  `max-image-preview`, `max-video-preview`, and a few others). Purely informational — having
  directives isn't inherently good or bad (a deliberately noindexed staging page is fine); this is
  a report, not a pass/fail check. An unrecognized token (a likely typo) is still listed, flagged
  as unrecognized, rather than silently dropped. No new gatherer — reads Lighthouse core's own
  `MetaElements` artifact plus the main document's response headers via core's `MainResource`
  computed artifact (the same one core's own `canonical` audit already uses).
- **`robots-directives-conflict`** — scored. Flags when the meta robots tag and the
  `X-Robots-Tag` header disagree on indexability (one says `noindex`/`none`, the other doesn't).
  Google honors the more restrictive of the two, but a mismatch is usually unintentional (e.g. a
  CDN or server config adding a blanket header that contradicts an intentionally-indexable page's
  meta tag) rather than a deliberate editorial choice, so this is worth failing a build over.
  Not-applicable unless **both** sources have at least one directive — a page with only a meta tag
  or only a header has nothing to conflict with, which is the normal case for most pages.
- **`canonical-https`** — flags a canonical URL that uses `http://` instead of `https://`.
  Deliberately narrow: Lighthouse core's own `canonical` audit already checks presence, validity,
  absoluteness, multiple-conflicting-canonicals, hreflang mismatches, and the "points to domain
  root" mistake (confirmed by reading its source before building this) — this audit only adds the
  HTTPS check. **Does not** re-fetch the canonical URL to confirm it actually resolves (200, not
  redirected/404/blocked) or chase canonical chains (A→B→A) — both would require a new
  outbound-fetch capability this package has never had, with real SSRF-prevention obligations (see
  `.ai-agents/prompts/security-checklist.md`); recorded as a "to do later" item in
  `docs/phases/phase-1-page-metadata.md` rather than built now.
- **`favicon-presence`** — flags when the page has no `<link rel="icon">`/`<link rel="shortcut
  icon">`. Doesn't verify the browser's implicit `/favicon.ico` fallback (that would need a
  network fetch this specific audit deliberately avoids).
- **`favicon-quality`** — purely informational suggestions: whether favicon coverage includes a
  scalable SVG or multiple declared sizes (sharper rendering across contexts), and whether an
  `apple-touch-icon` is declared (used for iOS home-screen icons). Not-applicable when there's no
  favicon at all — see `favicon-presence` for that.
- **`manifest-icons`** — scored. Fetches the web app manifest referenced by `<link
  rel="manifest">` and checks its `icons` array has at least one icon ≥192×192px (or scalable),
  Chrome's documented minimum for PWA installability. **This is the first audit in this package
  that fetches a second URL discovered on the page**, rather than only reading data Lighthouse's
  own page load already collected — see "A note on the SSRF-protected fetch" below before relying
  on or extending this. Not-applicable when there's no manifest link at all — most pages aren't
  meant to be installable, and that's a legitimate choice.
- **`open-graph-completeness`** (Phase 3) — checks Open Graph (`og:*`) tags against the actual
  protocol spec (`ogp.me`), not a guessed list: `og:title`/`og:type`/`og:image`/`og:url` are
  genuinely required (scored); `og:description`/`og:site_name`/`og:image:alt` (the last only when
  an `og:image` is present) are recommended and reported informationally, never failing the audit
  on their own. Deliberately does **not** check `og:image` pixel dimensions/aspect ratio — the
  spec states no minimum or recommended dimensions, so a numeric threshold here would be an
  invented, unverified number; see `docs/phases/phase-3-social-metadata.md`'s "To do later". No
  new gatherer — reads Lighthouse core's own `MetaElements` artifact, whose `property` field is
  exactly what `og:*` tags use (`robots-directives-report` reads the same artifact's `name` field
  for `<meta name="robots">`).
- **`open-graph-canonical-match`** — scored. `og:url` is defined by the Open Graph protocol as the
  page's canonical URL; flags when it disagrees with the page's actual `<link rel="canonical">`.
  Not-applicable when either is absent (presence is `open-graph-completeness`'s/core's `canonical`
  audit's concern) or unparseable.
- **`open-graph-image-reachable`** — scored. Fetches the `og:image` URL and confirms it resolves —
  a broken share image is a real, user-visible defect no markup-only check can catch. Reuses
  `safe-fetch.js`'s SSRF-protected request path via a new `safeFetchStatus` export (status-only,
  never downloads the image body). Not-applicable when there's no `og:image` at all.
- **`twitter-card-completeness`** — scored. `twitter:card` is the only tag genuinely required on
  its own; `twitter:title`/`twitter:description`/`twitter:image` fall back to their
  `og:title`/`og:description`/`og:image` equivalents when the `twitter:`-specific tag is absent, so
  they're checked as "required, with an Open Graph fallback." `twitter:site`/`twitter:creator`
  (attribution) and `twitter:image:alt` (when an image is present) are recommended, informational
  only. **Sourcing caveat, stated plainly**: X's official Cards documentation is largely
  paywalled/degraded since the platform's ownership change and couldn't be directly verified the
  way schema.org's pages were for `structured-data-deprecated-properties` — what's checked here is
  corroborated across multiple secondary sources, not a single fetched authoritative page.
- **`social-preview-content`** (Phase 3 item 5, "social preview renderer" — scoped down after a
  design conversation) — purely informational (`scoreDisplayMode: informative`, `score` always
  `null`). Reports the exact title/description/image URL each platform would actually use for its
  share-preview card, resolved through each platform's real fallback rules — **not** a rendered
  image. An actual visual render turned out not to be buildable inside a standard Lighthouse
  report at all: `details.type: 'screenshot'` is hardcoded internal-only for the `final-screenshot`
  audit's own special-cased UI (confirmed by reading
  `node_modules/lighthouse/report/renderer/details-renderer.js`'s `render()`, which explicitly
  returns `null` for it — "Internal-only details, not for rendering"), and no other `details` type
  can show a single composed image either. Building a real render would need editing
  `packages/viewer`, which is exactly the boundary this fork's own rules say audit/gatherer work
  shouldn't cross — so this reports the *content* that determines what a preview would say, not a
  picture of it. Shares `og:*`/`twitter:*` fallback-resolution logic with
  `twitter-card-completeness` via a new `src/lib/social-meta.js` (extracted so the two audits can't
  quietly disagree on what a platform would actually show). Not-applicable when there's no
  `og:*`/`twitter:*` content on the page at all; otherwise always reports both platform rows,
  regardless of whether `open-graph-completeness`/`twitter-card-completeness` pass — this is a
  report of what *would* show, not a pass/fail judgment.

- **`robots-txt-sitemap-declared`** (Phase 4) — scored. Passes when robots.txt has at least one
  `Sitemap:` line with an absolute http(s) URL (the one discovery route every crawler reads; a
  search-console submission also works, so treat it as a recommendation). Fails when robots.txt has
  no such line or does not exist. Not-applicable when robots.txt could not be retrieved (5xx or a
  network failure). Reads Lighthouse core's own `RobotsTxt` artifact; no new gatherer.
- **`robots-txt-crawler-access`** — scored on Googlebot and Bingbot only. Simulates robots.txt for
  those crawlers against the audited page *and* the same-origin CSS/JS the page actually loaded
  (blocking those stops a search engine rendering the page as a visitor sees it). The table also
  lists Googlebot-Image and the AI crawlers (GPTBot, ClaudeBot, CCBot, PerplexityBot) for
  reference; they are **never scored**, since blocking an AI crawler is a legitimate licensing
  choice. `Googlebot-Image` follows the `googlebot` group when robots.txt has no
  `googlebot-image` group, as Google documents. Cross-origin CSS/JS is skipped: robots.txt only
  governs its own origin. Uses `robots-parser` (already a Lighthouse dependency).
- **`robots-txt-rule-conflicts`** — scored. Flags the same path being both `Allow` and `Disallow`
  for one user-agent, with the line numbers; groups naming the same user-agent are merged first,
  since crawlers combine them. Google resolves a tie in favor of `Allow`, so the `Disallow`
  silently does nothing. Only identical path strings are compared: wildcard overlaps (`/a*` vs
  `/ab`) are not detected (see `docs/phases/phase-4-robots-sitemap.md`).
- **`sitemap-valid`**, **`sitemap-duplicate-urls`**, **`sitemap-limits`**, **`sitemap-url-status`**,
  **`sitemap-indexability`** (Phase 4) — five scored audits reading one shared artifact; see "Sitemap
  audits" below. A sixth, **`sitemap-robots-crossref`**, compares that artifact with robots.txt.

### A note on the SSRF-protected fetch (`manifest-icons`, `open-graph-image-reachable`, the sitemap audits, `src/lib/safe-fetch.js`)

Fetching a URL *discovered on the page* (as opposed to the page itself, which Lighthouse's own
runner already handles) is real SSRF attack surface — an attacker-controlled page could point its
manifest link at an internal service or a cloud metadata endpoint. `safe-fetch.js` protects
against this: scheme allowlist (http/https only), private/reserved-IP blocking *after* DNS
resolution (not just hostname string matching — covers RFC 1918, loopback, link-local including
the cloud metadata address, and IPv6 equivalents), DNS-rebinding resistance (the validated IP is
the exact one connected to, via Node's `lookup` request option, not re-resolved), no redirect
following, and a bounded timeout + response-size cap. Verified live: fetching a manifest URL
pointing at a closed local port was refused before any connection was attempted, with the refusal
reason surfaced in the audit's own `explanation`. See `test/lib/safe-fetch.test.js` for the full
protection test suite — including one case that caught a real bypass during development: Node's
`http`/`https` client silently skips the custom `lookup` option when the URL's hostname is already
a literal IP address, so a raw-IP manifest URL would have bypassed `safeLookup` entirely without an
explicit pre-check for that case (now present, and tested).

**A second real bug caught during Phase 3 live QA, not just a new-feature edge case**: `safeLookup`
always replied to Node's `lookup` request with a single `(address, family)` tuple. Node's own
`net.connect` requests `{all: true}` and expects an *array* back whenever Happy Eyeballs is active
— the default since Node 20 (`net.getDefaultAutoSelectFamily()`), which is the normal case for any
real `http.request`/`https.request` to a hostname, not an edge case. The mismatch made Node's own
connect logic throw `Invalid IP address: undefined`, silently breaking every real outbound fetch to
a non-literal-IP hostname — this would have broken `manifest-icons` in production against any real
manifest URL, not just the newly-added `open-graph-image-reachable` that happened to surface it
first (existing tests only exercised loopback/literal-IP targets and a permissive-lookup local test
server, never a real external hostname through the real request path). Fixed by having `safeLookup`
honor `options.all` and reply in the shape actually requested, same as real `dns.lookup` does —
confirmed live against a real external URL both before (crash) and after (correct status) the fix.

### Sitemap audits (`sitemap-valid`, `sitemap-duplicate-urls`, `sitemap-limits`, `sitemap-url-status`, `sitemap-indexability`)

All five read the `SitemapDocuments` artifact, produced once per run by
`src/gatherers/sitemap-documents.js`, so a sitemap is fetched and parsed a single time however many
audits use it. **How it works:**

- **Discovery**: the `Sitemap:` lines in robots.txt (absolute http(s) URLs only, at most 5). If
  robots.txt declares none (or does not exist), it probes `/sitemap.xml` on the page's origin. A 404
  or 410 there means "no sitemap": all three audits are not-applicable (a missing declaration is
  `robots-txt-sitemap-declared`'s concern). Any other failure, or robots.txt itself being
  unavailable (5xx, network error, redirect), also makes them not-applicable, since nothing can be
  concluded.
- **What is fetched**: each discovered sitemap, and, for a sitemap *index*, its child sitemaps one
  level deep, at most **10 documents per run**. Reaching the cap is reported as truncation, never as
  a pass for the unchecked files. Plain XML and gzip (`.xml.gz`, detected by the file's gzip magic
  bytes, not the URL) are both supported.
- **One shared page sample.** After the documents, the same gatherer requests a **sample of the URLs
  the sitemap lists, once each**, and both `sitemap-url-status` and `sitemap-indexability` read that
  one result, so checking status and indexability costs no extra requests to your site. For each
  sampled page it keeps the status, a redirect's `Location`, the `X-Robots-Tag` header(s) and content
  type, and, for a 2xx HTML page only, the first **64 KiB** of the body, reduced on the spot to the
  robots/googlebot/bingbot `<meta>` tags and the `<link rel="canonical">` in the `<head>` (parsed with
  `parse5`, the spec-compliant HTML parser). Raw HTML is never stored. A non-HTML page, a compressed
  one (`Accept-Encoding: identity` is requested, but a server may ignore it) or a non-2xx response is
  not read, though its headers still are. Same bounds and variables as `sitemap-url-status` below.
- **Cross-origin sitemaps are fetched.** The protocol lets robots.txt point at another host (a CDN,
  say), so those are checked too, through the same SSRF-protected path as everything else. The
  cost: a page's robots.txt can make the CLI issue a few bounded GET requests to public URLs of its
  choosing.
- **Redirects are reported, not followed.** A declared sitemap URL that redirects (http to https,
  non-www to www) fails `sitemap-valid` with the `Location` and the advice to declare the final
  URL. Google does follow redirects, so this is stricter than Google; the message says what to
  change. Following redirects would need a new, separately reviewed mode in `safe-fetch.js`.
- **Bounds**: each request has a 10 s **total** deadline (not only an idle timeout, so a server
  trickling bytes cannot hold it open) and a 50 MiB + 1 byte cap on the wire; gzip is inflated with
  a hard cap of 50 MiB + 1 on the *output* (a small "gzip bomb" cannot expand past it); parsing
  stops after 50,001 entries. One byte over each protocol limit is what lets `sitemap-limits` prove
  a file is over it without reading an unbounded amount. These are constants, deliberately not
  configurable: a knob that loosens a resource bound is a security decision.
- **Total time**: robots.txt and all the sitemap files share one **40 s budget**; each request gets
  the time left if that is less than its own 10 s limit, none is started with under 1 s left, and
  running out sets the same "only the first N sitemap files were checked" truncation the 10-file cap
  uses, so a cut-short run is never presented as complete. The page sample has its own separate
  **30 s** budget. Worst case for the whole gatherer, measured on a site where four sitemaps hang and
  every sampled page hangs: **about 70 s**. The cost: a very large sitemap on a slow server can be
  truncated where it would once have been read in full.

**The audits**

- **`sitemap-valid`** — passes when every discovered sitemap is reachable, well-formed XML (strict
  parsing, with line and column for the first error), has a `<urlset>` or `<sitemapindex>` root in
  the `http://www.sitemaps.org/schemas/sitemap/0.9` namespace, and lists only absolute http(s)
  `<loc>` values of at most 2,048 characters. Image, video, news and `xhtml:link` extension
  elements are tolerated but not validated. robots.txt `Sitemap:` lines that were ignored for not
  being absolute URLs are shown but do not fail the audit.
- **`sitemap-duplicate-urls`** — fails when one sitemap file lists the same `<loc>` more than once.
  URLs are compared as **exact strings**: `/a` vs `/a/`, or differing letter case, are different
  URLs and are not flagged, since they are not equivalent in general. The same URL in two
  *different* sitemap files is not flagged.
- **`sitemap-limits`** — fails when a file has more than 50,000 URLs (or, for an index, 50,000 child
  sitemaps) or is more than 50 MiB uncompressed, the sitemaps.org limits Google enforces. The table
  lists every checked file with entry count, compressed and uncompressed size, and gzip or not.

- **`sitemap-url-status`** — requests a **sample** of the URLs the sitemap lists and passes only if
  every one returns `2xx`; a redirect (`3xx`, shown with its target), `4xx`/`5xx`, or an unreachable
  URL fails. It is a spot check, not a crawl, and the result says how many of how many listed URLs
  were checked:
  - **Which URLs**: evenly spread across the listed URLs (first and last always included), the same
    on every run, so a CI assertion is stable and a broken tail is caught, not only the top.
  - **How many**: 10 by default; set **`LHCI_SEO_SITEMAP_SAMPLE_SIZE`** (a whole number, clamped to
    1-25, anything else falls back to 10) on a job that should check more. It is an environment
    variable, like the private-network opt-in: it is a bound on requests to your site, so a page must
    not be able to change it.
  - **Bounds**: 5 requests at a time, 5 s per request (one retry for a network error, never for an
    HTTP status), 30 s total; URLs the budget did not reach are listed as not checked.
  - **Only same-origin URLs are requested.** A listed URL on another host, scheme or port is counted
    and skipped, never fetched, so a sitemap cannot point this check at other hosts.
  - Redirects are reported, not followed. It judges the status only: whether a page is `noindex` or
    has a different canonical is `sitemap-indexability`'s check.
  - Now a pure function of the shared sample: its results are unchanged from before the sample was
    shared (pinned by a characterization test), it just makes no request of its own.
  - Not-applicable when no sitemap URL list could be checked.

- **`sitemap-indexability`** (Phase 4 item 9) — scored. A sitemap asks search engines to index its
  URLs, so a listed page that says "do not index me" or "index a different URL instead" contradicts
  it. Judged on the same sample as `sitemap-url-status`, and only for pages that returned `2xx`
  (anything else is `sitemap-url-status`'s finding):
  - **noindex** fails: an `X-Robots-Tag` header or a `<meta name="robots">`, and also ones aimed only
    at **Googlebot or Bingbot** (`<meta name="googlebot">`, `X-Robots-Tag: googlebot: noindex`).
    `noindex` and `none` count; every other directive is ignored. The row names the crawler(s) and
    the source. Each `X-Robots-Tag` header is read on its own, and a scope is recognized at the start
    of a header value.
  - **Canonical pointing elsewhere** fails: a `<link rel="canonical">` that, resolved against the
    page's URL (relative hrefs work, the fragment is ignored), is a different URL: another path, a
    query string, `http` vs `https`, `www` vs bare host, another host or port. A difference of only a
    **trailing slash** is a note, not a failure; several *different* canonicals on one page are noted
    as conflicting and not judged.
  - **What it cannot see, stated plainly**: it reads the raw HTML head of a plain request, so a
    noindex or canonical **added by client-side JavaScript is not seen**; it is a sample, not proof
    for every listed URL; and blocking by robots.txt is `sitemap-robots-crossref`'s check. It never
    lets a limit look like a pass: a page whose `<head>` was only partly read (more than 64 KiB
    before it ends), a compressed page and a non-HTML page (only its `X-Robots-Tag` header is
    checked) are each reported as a note.
  - Not-applicable when no sampled page returned `2xx`.

- **`sitemap-robots-crossref`** (Phase 4 item 8) — scored. A sitemap asks search engines to index
  its URLs and robots.txt tells them not to crawl some paths; a URL that is both listed and
  disallowed contradicts itself. Every same-origin URL the sitemap lists (all of them, not a sample:
  it is pure matching, no requests) is checked against robots.txt for **Googlebot and Bingbot**,
  and the failing rows say which. A more specific crawler group replaces `*` for that crawler, and
  an `Allow` that beats a broader `Disallow` is honored. Reads the sitemap artifact plus core's
  `RobotsTxt`; fetches nothing. URLs on other hosts are counted and skipped (robots.txt only governs
  its own origin), and AI-crawler-only blocks are not a conflict.
  - **The sitemap file's own path being disallowed** is also flagged, but as something to verify, not
    proof it is ignored: Google's own sitemap documentation does not say whether robots.txt rules
    apply to sitemap files (checked 2026-09-30), and search engines differ.
  - **Whether the audited page is listed in the sitemap** is shown for information only and never
    affects the score: many pages are legitimately left out (logins, filtered views).
  - Not-applicable when no sitemap URL list or robots.txt could be read; a missing robots.txt
    (404) means nothing is disallowed, so it passes.

- **`llms-txt-structure`** (Phase 4 item 10) — scored on structure **only when the file exists**.
  Fetches `/llms.txt` at the audited page's origin (through the SSRF-protected fetch: one request,
  1 MiB cap, 5 s, no redirects followed) and checks it against the format at llmstxt.org.
  **`llms.txt` is a community proposal (Jeremy Howard, September 2024), not a ratified standard, and
  this audit does not claim any search engine or AI system uses it**; it only checks that a file you
  chose to publish is well-formed. Not-applicable when the site has none (a 404 is not a failure:
  nothing requires one) or the file could not be fetched.
  - **Fails on**: no H1 title (the only part the format requires); an item that starts like a link
    but is not one (`- [name]` with no URL); an empty or non-http(s) link URL; and a file that is
    really an **HTML page** (a single-page app answering every path with its index page, the most
    common way `/llms.txt` "exists" without being one).
  - **Notes, never failures**: a missing blockquote summary or sections (optional), an H1 that is not
    first, several H1s, plain-text items or mid-sentence links inside a link section, a section with
    no links, links followed by text that does not start with a colon. Indented sub-bullets are
    ignored. This is deliberately lenient: it was tuned against real files from Stripe (docs and
    marketing sites), Anthropic's docs and nodejs.org, several of which use exactly these shapes, and
    failing them would make the audit noise. It is a judgment call about usefulness, not something
    llmstxt.org states.
  - **Not checked (deferred)**: that the listed links resolve, `llms-full.txt`, and an `llms.txt` at a
    subpath.
  - When the file cannot be checked (server error, an address refused by the SSRF policy, too large)
    the report carries a run warning saying why, including the `LHCI_SEO_ALLOW_PRIVATE_NETWORK`
    setting when that is the cause.

### Transport security audits (`mixed-content`, `hsts-quality`, `ssl-certificate-expiry`)

Three audits that read only what Lighthouse already collected for the page: no new gatherer and **no
request of their own** to your site. All are navigation-only and **not applicable** when the final page
URL is not `https:`.

- **`mixed-content`** (Phase 5) — an HTTPS page that loads something over plain `http://`. Built from
  Chrome's own report of what it blocked, auto-upgraded or allowed during the load, plus the `http:`
  requests the page made.
  - **Fails on**: any **active** resource (script, stylesheet, frame, fetch/XHR, font, form,
    worker, and any type it does not recognise), however Chrome resolved it, and any resource the
    browser **blocked**.
  - **Notes, never failures**: **passive** resources (image, audio, video, text track, favicon) that
    Chrome auto-upgraded or allowed with a warning. They are listed in the table with a plain-English
    "what it means" column, because the source still says `http://`.
  - **Limit**: it sees what Chrome reported during this load; a request made only after the page
    settles can be missed. Lighthouse's own `is-on-https` lists the same requests without the
    active/passive split and stays in the report.
- **`hsts-quality`** (Phase 5) — the main document's `Strict-Transport-Security` header.
  - **Fails on**: no header; `max-age` missing, malformed, `0`, or under 31,536,000 seconds (one year);
    `preload` set without `includeSubDomains` or without a one-year `max-age` (the preload list would
    reject it).
  - **Notes**: `includeSubDomains` absent; `preload` absent (optional); more than one header (browsers
    use only the first, and so does the audit).
  - **Not checked**: the preload list itself, other subdomains, and that a browser has visited over
    HTTPS first (HSTS is honoured only after that). Lighthouse's `has-hsts` is informational and stays
    in the report; this one has a pass/fail threshold.
- **`ssl-certificate-expiry`** (Phase 5) — the validity dates of the page's TLS certificate, read from
  the browser's own record of the connection.
  - **Score**: `1` with more than 15 days left; **`0.5` with 15 days or fewer** (and a warning in the
    report); `0` once expired or not yet valid. The partial score exists so CI can tell "expiring soon"
    from "fine" and from "expired", because `lhci assert` can gate on `minScore` but has no
    minimum-value check.
  - **Limit worth knowing**: Chrome refuses to load a page whose certificate has already expired and
    Lighthouse then stops without a report, so the `0` score is reachable only when certificate errors
    are ignored. In practice this audit is the **early warning** before that happens.
  - Not applicable when the browser reported no certificate dates (for example a reused connection).

### Soft-404 check (`soft-not-found`)

- **`soft-not-found`** (Phase 5) — does the site answer a URL that does not exist with a normal page? A
  **soft 404** (a catch-all route or a single-page app answering every path with HTTP 200, or unknown
  URLs bouncing to the homepage) lets search engines index endless junk URLs. The audit requests two
  made-up URLs on the audited page's own origin, built from a random token and never from anything the
  page says: a top-level path (`/lhci-seo-probe-<random>`) and a nested file-like one
  (`/lhci-seo-probe-<random>/page.html`), because some servers soft-404 only one shape.
  - **Fails on**: a made-up URL that returns **HTTP 2xx**, or that **redirects to a same-origin page
    that returns 2xx** (one hop is followed, status only).
  - **Not failures, shown in the table**: 404/410 (correct); another 4xx; a redirect to a page that is
    itself 404/410; a redirect that redirects again (not followed further); a redirect to **another
    origin** (never requested); a malformed or non-http `Location`; a server error (not a soft 404, but
    the row says unknown URLs should return 404); a probe that could not be requested (judged on the
    other one).
  - **Requests**: at most four status-only requests (two probes, in parallel, plus one hop each), 5 s
    each, through the SSRF-protected fetch (`LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies, so auditing
    `localhost` needs it). They will appear as 404s in your site's logs. If neither probe can be
    requested, the run carries a warning saying why and the audit is not applicable.
  - **Not checked (deferred to the crawler)**: "not found" wording on pages that return 200.
  - **Audit id**: it is `soft-not-found`, not `soft-404`. `lhci assert` treats a hyphen followed by a
    digit in an audit id as two audits (it asserts a phantom `soft404`), which would make every
    `lhci assert` run fail whatever the audit scored; `test/lighthouse-config.test.js` guards against it.

### URL variants: redirect consistency, chain length and loops (`url-variant-consistency`, `redirect-chain-length`, `redirect-loop`)

Three audits sharing one gatherer (`UrlVariants`), so the probes are made once. It requests the **audited
page's other forms** and follows each one's redirects by hand: `http://` of the same host, and the host with
`www` added or removed over `http://` and `https://`, always with the audited page's own path and query. A
redirect is followed only when it goes to one of those same-site host variants; any other target is
recorded and **never requested**. Bounds: three variants in parallel, at most 5 hops each, 5 s per request,
20 s per variant, all through the SSRF-protected fetch (`LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies). The
requests show as extra hits in your site's logs.

- **`url-variant-consistency`** — every other form should redirect to the audited URL.
  - **Fails on**: a form that **serves the page directly** (HTTP 2xx: the same content at two URLs); a
    chain that ends at a **different origin** than the audited one (e.g. `http://example.com` to
    `http://www.example.com`, still insecure); a chain that ends in an **error status**; and a redirect
    that **drops the path or query** (everyone is sent to the homepage).
  - **Notes, never failures**: a **temporary** redirect (302/303/307; a permanent 301/308 is the usual
    choice, but CDNs emit 302 by default); a form that does not exist (no such host, or nothing listening);
    a redirect to another site (not followed, so not judged); a probe that timed out.
- **`redirect-chain-length`** — **fails** when a form takes **more than 2 redirects** to resolve, or is
  still redirecting after 5. Geo or locale redirects count (a site that sends `/` to `/in` adds a hop).
- **`redirect-loop`** — **fails** when a redirect returns to a URL already visited, so a browser or
  crawler never reaches a page. Lighthouse itself aborts a run whose own page loops; this finds it on the
  variants.
- **What is and is not probed**: `www` is toggled only for an **apex host** (two labels) or a `www.` host.
  A subdomain such as `app.example.com` is not probed as `www.app.example.com`: wildcard DNS makes that
  name answer, and it would be reported as a false duplicate (a three-label apex such as `example.co.uk` is
  skipped for the same reason; a public-suffix list would fix that). Nothing is probed for an **IP
  address, `localhost`, a non-default port, or a page not served over HTTPS**: the three audits are then
  not applicable and say why, so a CI run against `localhost:3000` shows "not applicable", not a failure.
- **Not checked (deferred to the crawler)**: redirects of the site's *links* (internal links that redirect,
  chains from other pages). These audits cover the audited URL's own forms only.
- If a request is refused by the private-network policy, the run carries a warning naming the cause and
  the setting.

### Indexability: the verdict and the contradictions (`indexability-verdict`, `indexability-conflicts`)

One gatherer (`IndexabilitySignals`) and one decision tree over the signals a search engine weighs for the
audited page: HTTP status, robots.txt (Googlebot and Bingbot), meta robots and `X-Robots-Tag`
(including crawler-scoped values), the canonical, and how much visible text there is. Two audits read it.

- **`indexability-verdict`** — informational, never fails (a deliberate noindex is legitimate). Shows the
  five steps in a table and a plain-English verdict: *Indexable*, *Indexable, canonical elsewhere*,
  *Blocked by robots.txt*, *Not indexable (noindex)* or *Not indexable (HTTP 4xx/5xx)*, with the reason, and
  a pointer to `indexability-conflicts` when signals contradict each other. The text-content step is a
  note only (under 100 characters is flagged as "little to index"; a page that builds its content late with
  JavaScript can look empty).
- **`indexability-conflicts`** — **fails** when signals contradict each other, which is never intentional.
  Each row says what conflicts and why it matters:
  - **noindex that robots.txt hides**: a crawler that may not fetch the page never sees the noindex and can
    keep the URL in its index (checked per crawler).
  - **noindex together with a canonical to another URL**: "don't index me" and "index that instead".
  - **robots.txt blocks the page but its canonical points elsewhere**: the canonical cannot be read.
  - **a canonical on an error page** (HTTP 4xx/5xx).
  - **a bad canonical target**: when the canonical points to another URL **on the same origin**, the
    gatherer makes **one** request to it (through the SSRF-protected fetch; first 64 KiB of HTML, 5 s, no
    redirect followed; `LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies) and flags a target that redirects, returns
    an error, is itself noindex, is blocked by robots.txt, or declares yet another canonical (a chain). A
    target that could not be requested, or whose `<head>` was only partly read, is a note, not a failure. A
    cross-origin canonical is shown but never requested.
  - Not repeated here: meta-versus-header disagreement (`robots-directives-conflict`) and a noindex page
    listed in a sitemap (`sitemap-indexability`).
- **Limits**: only a canonical in the live `<head>` is seen (one declared only in an HTTP `Link` header is
  covered by Lighthouse's own `canonical` audit), and a noindex or canonical a script adds after the read is
  missed. **Reaching the error-page branches**: Lighthouse normally stops with `ERRORED_DOCUMENT_REQUEST`
  on a 4xx/5xx main document and produces no results, so "Not indexable (HTTP 404)" and the error-page
  canonical conflict only appear when you set `ignoreStatusCode: true` under `ci.collect.settings`
  (Lighthouse then records a run warning instead of stopping). The URL judged is the final URL Lighthouse
  reports, which can carry a query added after load (for example `https://www.google.com/?zx=...`, which
  Google's own robots.txt disallows).

### The site crawler (`crawl-coverage`, and what the cross-page audits read)

Every audit before Phase 7 judges **one page**. Phase 7's duplicate-detection audits compare a page with the rest of
the site, so this fork has a small, bounded, polite crawler whose snapshot they read. It runs **inside the normal
Lighthouse run** as the `SiteCrawl` gatherer; `lhci autorun` needs no extra step.

- **What it crawls** (one level, "depth 1"): the audited page, **the page's own internal links**, and the **URLs in
  the site's sitemap** (found through robots.txt `Sitemap:` lines, else `/sitemap.xml`). The links *of* those pages
  are stored but **not followed** (following links to a greater depth waits for Phase 8). Same origin only: a link or a
  redirect to another host, port or scheme is recorded and **never requested**. HTML only, server HTML (no JavaScript
  is run), up to 512 KiB per page.
- **What it keeps** per page: final URL and redirect chain, status, content type, `<title>`, meta description,
  canonicals, robots meta and `X-Robots-Tag`, the first five `<h1>` texts, a **hash** of the visible text with its
  length and word count, and the page's internal links. **Raw HTML is never stored.**
- **robots.txt is honoured by default**: URLs it disallows for the crawler's own user-agent
  (`lhci-seo-audits-crawler/1.0`, falling back to `*`) are not requested and are listed as blocked. The audited page is
  always requested once. If robots.txt cannot be read (a 5xx, a redirect, a network error) **only the audited page is
  requested** (the crawler does not guess what robots.txt would have allowed) and the run warns.
- **Default bounds**: 50 pages, 5 requests at a time, 5 s per request (one retry for a network error), redirects
  followed for at most 3 rounds and at most 3 requests per page, **120 s** in total, after which the rest is recorded as
  not checked.
- **`crawl-coverage`** (informational, never fails) shows what was crawled, what was blocked or skipped, and the limits
  in one table. Leave it out of `assertions`: Lighthouse normalises an informational score to 1, so a `minScore`
  assertion on it always passes.

**Environment variables** (read per run, clamped; a page can never change them):

| Variable | Default | Effect |
|---|---|---|
| `LHCI_SEO_CRAWL` | on | `0` or `false` switches the crawl off entirely (no requests; the audits that read it are not applicable) |
| `LHCI_SEO_CRAWL_MAX_PAGES` | 50 (1 to 200) | page cap, the audited page included |
| `LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS` | 120 (10 to 600) | total crawl time |
| `LHCI_SEO_CRAWL_RESPECT_ROBOTS` | on | `0` or `false` requests URLs robots.txt disallows (for auditing your own staging site) |
| `LHCI_SEO_CRAWL_CACHE_DIR` | `<tmp>/lhci-seo-crawl-<uid>` | where the snapshot cache lives (its parent must already exist) |
| `LHCI_SEO_CRAWL_CACHE_TTL_SECONDS` | 600 (0 to 86,400) | how long a snapshot is reused; `0` disables the cache |

`LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies as everywhere (auditing `localhost` or a private staging host needs it; without
it the crawl cannot run and the report carries a warning naming the setting).

**The cache.** `lhci collect` runs every Lighthouse run as its own process, so a cache on disk is how several URLs, or
several runs of one URL, crawl the site **once**: a fresh snapshot for the same origin and the same bounds is reused with
**no request to your site**, and another URL of the same site only gets its own page requested and added. The directory
is used only if it is a real directory (not a symlink) **owned by you with no group or other access**; anything else
means no cache, never a trusted forgery. Files are written atomically, a corrupt or expired file is ignored, and only the
extracted snapshot is stored.

**Cost.** On a cold cache the crawl sends up to about 100 requests to the audited site (visible in its logs) and can take
up to the time budget, inside whichever Lighthouse run first needs it. Lighthouse runs a gatherer **only when a selected
audit needs it**, so a run limited to Lighthouse's own categories (for example `onlyCategories: ['seo']`) does not crawl;
a run that includes this fork's `seo-extended` category does. Use `LHCI_SEO_CRAWL=0` to switch it off.

**Limits worth knowing.** The crawler reads **server HTML**. A site whose content is built by JavaScript serves the same
near-empty shell for every route, so pages can look identical here when they differ in a browser; `crawl-coverage` says
so, and notes it when the audited page shows far more text in a browser than the HTML the crawler received (either
the content is built by script, or the server answers non-browser requests differently, as `example.com` does). Pages beyond the cap
are a deterministic, evenly spread sample, not the whole site. `<base href>` is ignored and the body is read as UTF-8.

### Auditing a site on localhost or a private network (`LHCI_SEO_ALLOW_PRIVATE_NETWORK`)

The fetch path (`src/lib/safe-fetch.js`) refuses loopback and private addresses by default, because
the URLs it fetches (sitemaps, `og:image`, manifests) come from the audited page, and a page must
not be able to aim the CLI at your internal network or the cloud metadata service. That is the
right default for public pages, and the wrong one for CI that serves the built site on `localhost`
or audits a staging host on a private network: the sitemap audits would report not-applicable and
`manifest-icons` / `open-graph-image-reachable` would fail with "refused".

For those runs, set **`LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`** (or `true`) in the job's environment:

```yaml
      - run: lhci autorun
        env:
          LHCI_SEO_ALLOW_PRIVATE_NETWORK: '1'
```

- It is read from the process environment on every request. Nothing on an audited page can set it.
- It unblocks **only** loopback (`127.0.0.0/8`, `::1`), RFC 1918 (`10/8`, `172.16/12`,
  `192.168/16`) and IPv6 unique-local (`fc00::/7`), including IPv4-mapped spellings. The cloud
  metadata address and all link-local addresses (`169.254.0.0/16`, `fe80::/10`), `0.0.0.0`,
  carrier-grade NAT and multicast stay blocked even with it on, so it does not make a
  compromised page able to reach the metadata service.
- Set it only on jobs that audit hosts you control. On a job that audits pages you do not control,
  from a runner with access to internal services, leave it off.
- Without it, a skipped sitemap check adds a run warning to the report ("Sitemap audits were
  skipped: ... set LHCI_SEO_ALLOW_PRIVATE_NETWORK=1"), and a refused fetch in the other audits says
  the same, instead of silently showing not-applicable.

### Finding namespaces

Every report row from `structured-data-schema-properties` is tagged with which of three separate
concerns it came from — never blended into one undifferentiated list:

- **`google-requirements`** — a required/recommended property (Google's own terms, collapsed to one
  severity here) is missing. This is what drives the audit's score.
- **`eligibility`** — informational only, always present for a tracked type, always hedged (e.g. "may
  be eligible for consideration... does not guarantee Google will display a rich result"). Never
  affects score. A page can score 1 (all requirements met) and still show an eligibility row — that's
  expected, not a bug.
- **`schema-org`** — used by `structured-data-json-ld`'s own JSON-LD structural validity check
  (`@context`/`@type` presence), not by `structured-data-schema-properties`.
- **`duplicate-count`**/**`conflicting-entity`** — used by `structured-data-type-conflicts` (see
  above); `duplicate-count` drives that audit's score, `conflicting-entity` never does.
- **`deprecated-property`** — used by `structured-data-deprecated-properties` (see above); always
  `severity: 'info'`, never drives a score.

`pixel-width-truncation` deliberately does **not** use the `Finding` model at all — it reports a
direct measured-pixel-width-vs-budget table, not a namespaced finding, since `Finding`'s shape
doesn't fit that data naturally.

Rule content is versioned (`rules/{namespace}/{version}.json`, e.g. `2026-09`) — every audit result
stamps which ruleset version(s) it used into `details.rulesetVersions`, so an old report can be
understood against the rules that actually existed when it ran, even after `rules/*/current.json`
has moved on to a later version.

## Using it

This package isn't imported by any other package in this monorepo directly — Lighthouse loads it via
its own `configPath` setting. Point your `.lighthouserc.js` at it:

```js
module.exports = {
  ci: {
    collect: {
      settings: {
        configPath: require.resolve('@lhci/seo-audits/lighthouse-config.js'),
      },
    },
  },
};
```

This adds all forty-one audits (`structured-data-json-ld`, `structured-data-schema-properties`,
`structured-data-rich-result-eligibility`, `structured-data-type-conflicts`,
`structured-data-deprecated-properties`, `pixel-width-truncation`,
`meta-description-identical-to-title`, `document-title-quality`, `document-h1-count`,
`h1-title-relevance`, `robots-directives-report`, `robots-directives-conflict`, `canonical-https`,
`favicon-presence`, `favicon-quality`, `manifest-icons`, `open-graph-completeness`,
`open-graph-canonical-match`, `open-graph-image-reachable`, `twitter-card-completeness`,
`social-preview-content`, `robots-txt-sitemap-declared`, `robots-txt-crawler-access`,
`robots-txt-rule-conflicts`, `sitemap-valid`, `sitemap-duplicate-urls`, `sitemap-limits`,
`sitemap-url-status`, `sitemap-robots-crossref`, `sitemap-indexability`, `llms-txt-structure`, `mixed-content`, `hsts-quality`,
`ssl-certificate-expiry`, `soft-not-found`, `url-variant-consistency`, `redirect-chain-length`,
`redirect-loop`, `indexability-verdict`, `indexability-conflicts`, `crawl-coverage`) on top of
Lighthouse's default audits (via `extends: 'lighthouse:default'`
— see `src/lighthouse-config.js`), in a new `seo-extended` category, without replacing or altering
any of Lighthouse's own defaults.

### Assertion severity

None of the forty-one audits are part of this fork's shared `all`/`recommended` presets
(`packages/utils/src/presets/`) — those presets are constrained to audits Lighthouse ships by
default, and all forty-one here are opt-in via `configPath`, so they can't be part of that
guarantee. Set severity yourself in your own `.lighthouserc.js`:

```js
module.exports = {
  ci: {
    collect: {settings: {configPath: require.resolve('@lhci/seo-audits/lighthouse-config.js')}},
    assert: {
      assertions: {
        'structured-data-json-ld': ['error', {}], // or 'warn'
        'structured-data-schema-properties': ['error', {}], // or 'warn'
        // See the note below — a minScore assertion on this audit always passes, by design.
        'structured-data-rich-result-eligibility': ['warn', {}],
        // Has a real scored component (duplicate-count) — a minScore assertion is meaningful here.
        'structured-data-type-conflicts': ['error', {}], // or 'warn'
        // Same informational-only caveat as structured-data-rich-result-eligibility — see below.
        'structured-data-deprecated-properties': ['warn', {}],
        // Same informational-only caveat as structured-data-rich-result-eligibility — see below.
        'pixel-width-truncation': ['warn', {}],
        // Scored normally, no approximate-ruleset caveat — a minScore assertion is meaningful here.
        'meta-description-identical-to-title': ['error', {}], // or 'warn'
        'document-title-quality': ['error', {}], // or 'warn'
        'document-h1-count': ['error', {}], // or 'warn'
        // Deliberately weak heuristic, never gates CI — same informational caveat as above.
        'h1-title-relevance': ['warn', {}],
        // Purely informational, always passes — see below.
        'robots-directives-report': ['warn', {}],
        // A real technical conflict, scored normally.
        'robots-directives-conflict': ['error', {}], // or 'warn'
        'canonical-https': ['error', {}], // or 'warn'
        'favicon-presence': ['error', {}], // or 'warn'
        // Purely informational, always passes — see below.
        'favicon-quality': ['warn', {}],
        'manifest-icons': ['error', {}], // or 'warn'
        'open-graph-completeness': ['error', {}], // or 'warn'
        'open-graph-canonical-match': ['error', {}], // or 'warn'
        'open-graph-image-reachable': ['error', {}], // or 'warn'
        'twitter-card-completeness': ['error', {}], // or 'warn'
        // Same informational-only caveat as structured-data-rich-result-eligibility — see below.
        'social-preview-content': ['warn', {}],
        // Scored; a recommendation, since a search-console submission also works.
        'robots-txt-sitemap-declared': ['warn', {minScore: 1}],
        // Scored on Googlebot/Bingbot only; AI crawlers appear in the table but never fail it.
        'robots-txt-crawler-access': ['error', {minScore: 1}],
        'robots-txt-rule-conflicts': ['warn', {minScore: 1}],
        // A malformed, unreachable or redirecting sitemap is a definite defect. If your sitemap
        // URL legitimately redirects (Google follows that), prefer 'warn'.
        'sitemap-valid': ['error', {minScore: 1}],
        // Google documents these as hard limits it enforces; content over them is ignored.
        'sitemap-limits': ['error', {minScore: 1}],
        // Search engines tolerate duplicates, and matching is deliberately exact-string.
        'sitemap-duplicate-urls': ['warn', {minScore: 1}],
        // A listed URL that 404s or redirects is a definite defect, but this is a sample and a
        // network blip can fail a URL; 'warn' by default, 'error' once you trust your sitemap.
        'sitemap-url-status': ['warn', {minScore: 1}],
        // A listed noindex page is a definite contradiction, but a canonical can legitimately point
        // at a variant, it is a sample, and JavaScript-added tags are invisible to it: 'warn' until
        // you have confirmed your sitemap is clean, then consider 'error'.
        'sitemap-indexability': ['warn', {minScore: 1}],
        // Listing a URL the same site disallows is a definite contradiction, not a judgment call.
        'sitemap-robots-crossref': ['error', {minScore: 1}],
        // llms.txt is an unratified proposal and optional, so 'warn' unless you want to gate on it.
        'llms-txt-structure': ['warn', {minScore: 1}],
        // Fails only on blocked or active content, which Chrome itself reports and which breaks the
        // page: low false-positive risk.
        'mixed-content': ['error', {minScore: 1}],
        // Staging and internal hosts legitimately omit or shorten HSTS, and a CDN may set it only
        // at the edge in production: 'warn', or 'error' on production-only jobs.
        'hsts-quality': ['warn', {minScore: 1}],
        // 0.5 means 15 days or fewer left, 0 means expired. One assertion per audit id, so to fail
        // on expiry but be told at 15 days, see the assertMatrix recipe just below this block.
        'ssl-certificate-expiry': ['error', {minScore: 0.5}],
        // A site that serves junk URLs as normal pages is a real defect, but it needs the site's own
        // routing to fix and is a probe of two URLs: 'warn' first, 'error' once confirmed.
        'soft-not-found': ['warn', {minScore: 1}],
        // A form serving the page directly, or dropping the path, splits your pages across URLs.
        'url-variant-consistency': ['warn', {minScore: 1}],
        // A long chain is slow and leaks link signals, but is rarely broken.
        'redirect-chain-length': ['warn', {minScore: 1}],
        // A loop means a URL form is unreachable: always a defect.
        'redirect-loop': ['error', {minScore: 1}],
        // Informational: Lighthouse normalizes its score to 1, so this assertion never fails; omit it if you like.
        'indexability-verdict': ['warn', {}],
        // Signals that contradict each other are never intentional, but the canonical-target check is a
        // single request and a CDN can answer it oddly: 'warn' first, 'error' once confirmed.
        'indexability-conflicts': ['warn', {minScore: 1}],
      },
    },
  },
};
```

**Failing CI on certificate expiry but being told 15 days earlier.** An `assertions` map holds one
entry per audit id, so two severities for `ssl-certificate-expiry` need an `assertMatrix` with two
entries on the same URL pattern (verified with a real `lhci assert`: score `1` is clean, `0.5` prints a
warning and exits 0, `0` prints an error and exits 1):

```js
assert: {
  assertMatrix: [
    {matchingUrlPattern: '.*', assertions: {'ssl-certificate-expiry': ['error', {minScore: 0.5}]}},
    {matchingUrlPattern: '.*', assertions: {'ssl-certificate-expiry': ['warn', {minScore: 1}]}},
  ],
},
```

`assertMatrix` cannot be combined with `preset` or a top-level `assertions` block in the same `assert`
config, so use it in a separate `lhci assert` run (or move all your assertions into matrix entries).

**A note on asserting `structured-data-rich-result-eligibility`,
`structured-data-deprecated-properties`, `pixel-width-truncation`, `h1-title-relevance`,
`robots-directives-report`, `favicon-quality`, and `social-preview-content`**: all seven audits are
`scoreDisplayMode: informative` (none ever has a pass/fail score, by design — see
above). Verified live (`lhci collect`/`lhci assert` against a real page): Lighthouse itself
normalizes an `informative` audit's LHR `score` to `1` before `lhci assert` ever reads it
(`node_modules/lighthouse/core/audits/audit.js`'s `_normalizeAuditScore`) — so a `minScore`
assertion on any of the seven **always passes**, at any threshold, regardless of what the report
actually shows. This means there's genuinely nothing to gate CI on with `minScore` for any of them;
the common case is to simply not add them to `assertions` at all, since an `['error', {}]` entry
will never actually fail — it isn't dangerous, just a no-op as a CI gate. (An earlier draft of this
note claimed the opposite — that `['error', {}]` would always *fail* — based on reading
`packages/utils/src/assertions.js`'s `minScore` logic in isolation; that reasoning missed that
Lighthouse core normalizes the score before `lhci assert` sees it, and was corrected after running
a real `lhci assert` against a real collected result during `structured-data-rich-result-eligibility`'s
QA — every informational audit built after that one carried the already-corrected conclusion
forward rather than re-deriving and re-risking the same mistake.)

For `pixel-width-truncation` specifically, that informational-only status isn't just a convenience
choice — it follows directly from the ruleset-accuracy caveat above: gating CI on an unverifiable,
reverse-engineered approximation would fail builds based on a guess this repo cannot confirm the
accuracy of. For `h1-title-relevance`, it's because the word-overlap heuristic can produce false
positives on a genuinely relevant H1 (synonyms, rephrasing) — see its own entry above.
