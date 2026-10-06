# Changelog draft

## Unreleased

### structured-data-validation (2026-09-27)

**User-facing**: Added a new opt-in audit, `structured-data-json-ld`, via the new `@lhci/seo-audits`
package. It checks every `<script type="application/ld+json">` block on a page for valid JSON and
the required `@context`/`@type` fields — something Lighthouse's own built-in `structured-data` audit
does not do (it's a manual placeholder that just tells you to run an external tool). To use it, point
your `.lighthouserc.js` at `require.resolve('@lhci/seo-audits/lighthouse-config.js')` via
`collect.settings.configPath` — see `packages/seo-audits/README.md` for the full setup, including how
to set your own assertion severity (this audit is not part of the `recommended`/`all` presets, since
it's opt-in and not one of Lighthouse's own default audits).

**Internal/dev**: New workspace package `packages/seo-audits` (`@lhci/seo-audits`), the first
fork-specific addition to this repo and the first ESM package alongside the existing CommonJS ones —
required because Lighthouse loads custom `configPath`/audit/gatherer files via dynamic `import()` and
its own base classes are ESM. Added a scoped ESLint `overrides` entry for
`packages/seo-audits/**/*.js` (`sourceType: 'module'`, `strict` off) rather than changing the global
lint config. Built through the `.ai-agents/` pipeline end-to-end (docs at
`docs/feature-specs/structured-data-validation.md` and sibling `docs/audit-specs/`,
`docs/feature-contracts/`, `docs/task-sequences/`, `docs/qa/` files) — first real run of the pipeline,
which caught one dead-end feature request already satisfied by upstream (`missing-meta-description`)
before this one, and one design correction mid-flight (plugin mechanism vs. custom `configPath`, since
Lighthouse plugins can't register new gatherers).

No migration note needed — no existing `.lighthouserc.js` config key was added or changed; this
feature is entirely opt-in via Lighthouse's own pre-existing `configPath` setting.

### structured-data-rule-engine (2026-09-28)

**User-facing**: Added a second opt-in audit, `structured-data-schema-properties`, alongside
`structured-data-json-ld`. For JSON-LD blocks with `@type: "Product"` or `@type: "Article"` (more
types planned), it checks that Google's documented required/recommended properties are present —
including nested ones, like `Product.offers.price`/`priceCurrency`/`availability` — and separately
reports (always hedged, never affecting the score) whether the type is one Google currently
documents rich-result support for at all. Same `configPath`/severity setup as the existing audit —
see `packages/seo-audits/README.md`.

**Internal/dev**: The rule content behind `structured-data-schema-properties` (and, after a
refactor, `structured-data-json-ld`'s own `@context`/`@type` check) is no longer hardcoded in audit
logic — it's versioned JSON data under `packages/seo-audits/rules/{namespace}/{version}.json`,
loaded through a small rule registry/engine (`src/rule-engine/`) that schema-validates every ruleset
file via `ajv`. Every audit result stamps which ruleset version(s) it used into
`details.rulesetVersions`, mirroring Lighthouse's own `lighthouseVersion` LHR field, so an old report
stays interpretable against the rules that existed when it ran. Three separate, never-conflated rule
namespaces: schema.org validity, Google's requirements, and rich-result eligibility (eligibility is
informational only and never fails the audit). Full architecture rationale — including what's
deliberately *not* built yet (automated Google-doc-change detection, LLM-assisted rule extraction,
autonomous publishing) and why — is in `docs/architecture/structured-data-rule-engine.md`.

Two real toolchain findings from this feature, now documented in `lighthouse-conventions.md` for
future audits: (1) the registry's `import.meta.url` usage can never be compiled by this repo's
shared `module: "commonjs"` tsconfig, so any audit touching the rule engine needs a shell-out test
pattern, not a direct Jest import; (2) writing "@type"/"@context" in prose inside a JSDoc comment
gets misparsed as an actual JSDoc tag.

No `.lighthouserc.js` migration note needed — same reasoning as `structured-data-validation`, this
is opt-in via the existing `configPath` mechanism.

### structured-data-remaining-types (2026-09-28)

**User-facing**: `structured-data-schema-properties` now checks all 12 rich-result types Google
documents property guidance for, not just `Product`/`Article` — adds `BreadcrumbList`, `Recipe`,
`Review`, `Event`, `JobPosting`, `VideoObject`, `Organization`, `LocalBusiness`, `FAQPage`, and
`HowTo`. No setup change — same audit id, same `configPath`/severity wiring as before. Two things
worth knowing if you rely on this audit: nested-property checks only go one level deep (so
`FAQPage`'s `acceptedAnswer.text` isn't verified, only that `acceptedAnswer` itself is present), and
`FAQPage`/`HowTo` are reported as *not* eligible for a rich result — Google currently restricts both
to a narrow set of authoritative sites, and this audit's eligibility model can't express "eligible
but restricted," so it reports the closer of the two available answers. See
`packages/seo-audits/README.md` for both caveats in full.

**Internal/dev**: Proof point for the rule-engine architecture from the previous feature — adding 10
new types required zero changes to `src/audits/structured-data-schema-properties.js` or any
`src/rule-engine/*.js` file, only new ruleset JSON (`rules/google/structured-data/2026-10.json`,
`rules/eligibility/2026-10.json`) plus a `current.json` version bump. Confirmed the engine's
one-level `nested` mechanism already handles array-valued properties (e.g.
`BreadcrumbList.itemListElement`, `FAQPage.mainEntity`) with no code change, since `asObjectArray`
already normalizes a single object or an array identically. One pre-existing test
(`registry.test.js`) had hardcoded the tracked-type list to `['Article', 'Product']` and needed
updating — a real regression this feature's task sequence specifically planned a task around,
not discovered after the fact. Live-verified via `lhci collect`/`lhci assert` that the `current.json`
version bump alone (no code deploy) was sufficient to bring all 10 new types online — see
`docs/qa/structured-data-remaining-types.md`.

No `.lighthouserc.js` migration note needed — same reasoning as the prior two features.

### structured-data-rich-result-eligibility (2026-09-29)

**User-facing**: Added a third opt-in audit, `structured-data-rich-result-eligibility`, alongside
`structured-data-json-ld` and `structured-data-schema-properties`. Purely informational (never a
pass/fail score): for every distinct schema type found in JSON-LD on the page, it reports one row
showing whether Google currently documents rich-result guidance for that type and which feature if
so — including types `structured-data-schema-properties` doesn't check properties for, so it's a
complete inventory, not a subset. Two blocks of the same type collapse into one row with a count,
not duplicate rows. Same `configPath` setup as the other two audits — see
`packages/seo-audits/README.md`. If you set a `minScore` assertion on this audit, know that it will
always pass regardless of threshold (Lighthouse normalizes informational-audit scores to `1` before
`lhci assert` ever sees them) — there's genuinely nothing to gate CI on here, so the common case is
to just not assert it at all.

**Internal/dev**: Uses Lighthouse's own `scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE` (the
same mechanism core audits like `critical-request-chains` use), the first audit in this package to
do so. Reuses the existing `eligibility-engine.js`/`eligibility` ruleset namespace as-is — no new
rule-engine or ruleset-data changes, audit-layer only. Worth recording as a real process win: the
design-time audit spec and contract initially claimed the *opposite* assertion behavior (that an
unconfigured `['error', {}]` assertion would always *fail*), reasoned from reading
`packages/utils/src/assertions.js` in isolation. Running a real `lhci assert` during `/write-qa`
disproved that and traced the actual cause to `_normalizeAuditScore` in Lighthouse core — corrected
across the audit spec, contract, and README rather than left wrong. See
`docs/qa/structured-data-rich-result-eligibility.md` for the full trace.

No `.lighthouserc.js` migration note needed — same reasoning as the prior three features.

### structured-data-type-conflicts (2026-09-29)

**User-facing**: Added a fourth opt-in audit, `structured-data-type-conflicts`, alongside the other
three. Two independent checks, different severity: **`duplicate-count`** (scored, can fail the
audit) flags a schema type Google's guidance expects at most once per page —
`Organization`/`WebSite`/`BreadcrumbList` in v1 — appearing more than once. **`conflicting-entity`**
(informational only, never affects score) flags two blocks of the same type that share a strong
identity field (e.g. `Product.sku`/`gtin`/`mpn`, or `url` for several other types) but disagree on
another field — deliberately conservative: a block with no identity field for its type is never
compared for conflicts at all, so this won't flag a product-listing page's legitimately different
products as conflicting with each other. Same `configPath` setup as the other three — see
`packages/seo-audits/README.md`. Unlike `structured-data-rich-result-eligibility`, a `minScore`
assertion on this audit *is* meaningful (verified live) — `duplicate-count` genuinely drives score.

**Internal/dev**: A genuine fourth rule-engine namespace (`type-conflicts`), following the
established versioned-data pattern rather than a one-off exception — new JSON Schema, new pure
engine module (`findDuplicates`/`findConflicts`), and the first feature to touch the shared
`registry.js` (additive-only: one new `resolve*Ruleset` function, re-verified against the full
`seo-audits` suite during implementation to confirm zero regression in the three already-shipped
audits). Two Gate-0 blocking questions were asked before design started, per the newly-added
`.ai-agents/prompts/blocking-questions.md` rule — the entity-matching heuristic (strong identity
fields only, no name-only fallback) and the singular-type list — rather than picked unilaterally
and only noted in the spec.

A real security finding was caught during `/security-review` and fixed the same sitting, not
deferred: `typeCounts`/`blocksByType` were built as plain object literals keyed directly by the
page's own JSON-LD `@type` value — a block declaring `"@type": "__proto__"` would silently
reassign that object's own prototype via the inherited setter (confirmed not to pollute the global
`Object.prototype`, but still unintended behavior a page shouldn't be able to trigger). Fixed with
`Object.create(null)` for both objects, with its own regression test. See
`docs/qa/structured-data-type-conflicts.md` and `.ai-agents/state/security-findings.md` for the
full write-up.

No `.lighthouserc.js` migration note needed — same reasoning as the prior features.

### sitemap-fetch-and-parse (2026-09-30, Phase 4)

**User-facing**: Three new opt-in audits check your XML sitemap, all in the `seo-extended`
category: **`sitemap-valid`** (reachable, well-formed XML, correct root and namespace, only absolute
http(s) URLs; a redirecting sitemap URL is reported, with the advice to declare the final URL),
**`sitemap-duplicate-urls`** (the same URL listed twice in one sitemap file; exact-string matching,
so `/a` and `/a/` are not flagged), and **`sitemap-limits`** (more than 50,000 URLs or 50 MiB
uncompressed, the limits Google enforces; the table lists every file with entry count and size,
gzip or not). Sitemaps are found through the `Sitemap:` lines in `robots.txt`, falling back to
`/sitemap.xml`; gzip (`.xml.gz`) and sitemap indexes (one level deep) are supported. Each run checks
at most 10 sitemap files and says so when it stops there. Not-applicable when no sitemap exists.
Same `configPath` setup as the other audits, and suggested severities are in
`packages/seo-audits/README.md`: `error` for `sitemap-valid` and `sitemap-limits`, `warn` for
`sitemap-duplicate-urls`. These audits fetch over the network from Node, which refuses loopback and
private addresses, so they cannot be tried against a `localhost` page (they report not-applicable);
use a public site.

**Security fix, affects other audits too**: the shared SSRF-protected fetch used by
`manifest-icons` and `open-graph-image-reachable` did not check IPv6 addresses written in brackets
(`http://[::ffff:127.0.0.1]/`, `http://[::1]/`), so a page could point a manifest or `og:image` link
at an internal service, or the cloud metadata address in its IPv4-mapped form, and have the CLI
request it. Those are now refused, along with IPv4-mapped, NAT64 and 6to4 forms wrapping a private
address. If you run this fork against untrusted pages from cloud infrastructure, take this update.

**Internal/dev**: Full 9-stage pipeline for the gatherer (first with outbound requests in this
package): `SitemapDocuments` fetches and parses every discovered sitemap once, so the three audits
(and the upcoming URL-status sample and cross-checks) share one artifact. Core's `RobotsTxt` cannot
be a gatherer dependency (only gatherers with a `meta.symbol` can), so robots.txt is fetched again
through the SSRF path. New `safeFetchBytes` in `src/lib/safe-fetch.js` (non-2xx returned not thrown,
total wall-clock deadline rather than an idle timeout); pure parse core `src/lib/sitemap-parse.js`
using `saxes` (strict, with line and column) with gzip decompression capped on output. Decisions made
with the developer: cross-origin `Sitemap:` URLs are fetched; redirects are reported, not followed.
Deviation from the contract, recorded in it: wire cap is 50 MiB + 1, not 15 MiB. Task order and
per-task tests: `docs/task-sequences/sitemap-fetch-and-parse.md` (12 commits).

`/security-review` found two `high` issues by running attacks rather than reading code, both fixed
before the next feature: the bracketed-IPv6 SSRF bypass above (pre-existing since Phase 1, first
reachable from page-controlled input there), and a quadratic-time parser DoS, where 96 KB of nested
tags took 17 s and parsing is synchronous so no timeout applies (now capped at 32 levels, 1 ms). Two
`low` items are in the backlog (no overall gatherer time budget; private-address pages give no
"refused by policy" reason). See `.ai-agents/state/security-findings.md` and
`docs/qa/sitemap-fetch-and-parse.md`. QA against real sites found a genuine duplicate on MDN's live
sitemap. Open: the 12 failing suites in the full `npm run test` (Storybook/Puppeteer, `packages/server`)
were not confirmed against the base branch (`.ai-agents/state/ci-backlog.md`).

No `.lighthouserc.js` migration note needed: no new config keys (the caps are constants on purpose).

### private-network opt-in (2026-09-30, follow-up to sitemap-fetch-and-parse)

**User-facing**: New environment variable **`LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`** for CI jobs that audit
a site served on `localhost` or a staging host on a private network. By default the SSRF-protected
fetch (used by the sitemap audits, `manifest-icons` and `open-graph-image-reachable`) refuses
loopback and private addresses, so on such a site the sitemap audits showed not-applicable and the
other two failed with "refused". With the variable set, loopback, RFC 1918 and IPv6 unique-local
addresses are allowed; the cloud metadata address and all link-local, `0.0.0.0`, carrier-grade NAT
and multicast addresses stay blocked. Set it only on jobs that audit hosts you control. Without it,
a skipped sitemap check now adds a run warning to the report naming the cause and the setting,
instead of silently reporting not-applicable. See the README section "Auditing a site on localhost or
a private network".

**Internal/dev**: one decision point, `isBlockedAddress`, used by `safeLookup` and the three
literal-IP checks; `isPermittedPrivateAddress` is the fixed allowlist the variable may unblock;
`optInHint` adds the setting name to a refusal only when the setting would have helped (never for a
metadata-address refusal). `SitemapDocumentsArtifact` gains `unavailableReason`, and the gatherer
pushes a `LighthouseRunWarnings` entry when discovery is unavailable. Closes finding 4 of the
sitemap security review. No `.lighthouserc.js` key: it is an environment variable on purpose, since a
config-file setting could be committed to a repo that also audits untrusted pages.

### sitemap-url-status (2026-09-30, Phase 4 item 5)

**User-facing**: New opt-in audit **`sitemap-url-status`**: requests a sample of the URLs your sitemap
lists and fails if any does not return `2xx` (a redirect, 404, 5xx or unreachable URL all fail; a
redirect is shown with its target). It is a spot check, not a crawl: 10 URLs by default, evenly spread
across the sitemap (first and last included) and identical on every run so CI results are stable; set
`LHCI_SEO_SITEMAP_SAMPLE_SIZE` (1-25) on a job that should check more. Only URLs on the same host as
their sitemap are requested. Whether a page is `noindex` is not checked. Suggested severity `warn`
(it is a sample, and a network blip can fail a URL); see the README. On its first real run it found a
genuine bug in nodejs.org's own sitemap (URLs with the dots stripped, which 404).

**Internal/dev**: lightweight mode on the existing `SitemapDocuments` artifact, so no new gatherer.
Pure logic in `src/lib/sitemap-url-sample.js` (deterministic even sampling, same-origin filter,
worker pool with per-request race timeout, one network-error retry, total budget) with the status
fetcher injected; the audit is thin. `safeFetchStatus` additively returns `redirectLocation` for a
3xx. Decisions confirmed with the developer before coding (sample selection, redirects fail, size
and how to set it). No `.lighthouserc.js` key: the sample size is an environment variable on purpose.

### sitemap-robots-crossref (2026-09-30, Phase 4 item 8)

**User-facing**: New opt-in audit **`sitemap-robots-crossref`** catches a sitemap that contradicts
your robots.txt: it checks **every** URL the sitemap lists (not a sample) against robots.txt for
Googlebot and Bingbot and fails on any that a search engine is told not to crawl, naming which one.
Also flags a sitemap whose own path robots.txt disallows (worded as "verify": Google's documentation
does not say whether it applies robots.txt to sitemap files). Whether the audited page is listed in
the sitemap is shown for information only and never affects the result. Makes no requests, so it is
fast on huge sitemaps (52,000 URLs on MDN). Suggested severity `error`. Only same-host URLs are
checked, since robots.txt only governs its own origin.

**Internal/dev**: lightweight mode on two existing artifacts (`SitemapDocuments` and core's
`RobotsTxt`), no new gatherer or fetch. Pure logic in `src/lib/sitemap-robots-crossref.js` reusing
`robots-parser` and the scored crawler list from `robots-access.js`. Design decisions were confirmed
with the developer before coding. No `.lighthouserc.js` key.

### llms-txt-structure (2026-09-30, Phase 4 item 10)

**User-facing**: New opt-in audit **`llms-txt-structure`** checks a site's `/llms.txt`, if it has one,
against the llmstxt.org format: it fails on no H1 title (the only required part), a link-like item
that is broken (`- [name]` with no URL), an empty or non-http(s) link URL, and a file that is really
an HTML page (a single-page app answering every path with its index page). Everything else that real
files do (no summary, plain-text items, sub-bullets, an H1 that is not first) is shown as a note and
never fails; it was tuned against Stripe, Anthropic's docs, nodejs.org and llmstxt.org. A site with no
`llms.txt` is not-applicable, not a failure. **llms.txt is an unratified community proposal and the
audit says it does not claim any search engine or AI system uses it.** Suggested severity `warn`. When
the file cannot be fetched (for example a localhost site without `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`),
the report carries a run warning saying why. Links inside the file are not checked yet.

**Internal/dev**: lightweight mode: a small `LlmsTxt` gatherer (one `safeFetchBytes` to the page
origin's `/llms.txt`, 1 MiB, 5 s, no redirects, run warning when unavailable) and a thin audit over a
pure parser in `src/lib/llms-txt.js`. The first version was too strict and failed real files from
Anthropic and Stripe; it was loosened during live QA so only unambiguous violations fail. Deferred:
link reachability, `llms-full.txt`, subpath files. No `.lighthouserc.js` key.

### sitemap-indexability (2026-10-01, Phase 4 item 9)

**User-facing**: New opt-in audit **`sitemap-indexability`** flags a URL your sitemap lists whose own
page says it should not be indexed: **noindex** (an `X-Robots-Tag` header or a `<meta name="robots">`,
including ones aimed only at Googlebot or Bingbot such as `<meta name="googlebot">` or
`X-Robots-Tag: googlebot: noindex`) or a **canonical pointing to a different URL** (a different path,
query string, `http`/`https`, `www`, host or port; a trailing-slash-only difference is a note). It checks
the same evenly spread sample as `sitemap-url-status` and only pages that returned 2xx. It reads each
page's raw HTML head, so a noindex or canonical added by client-side JavaScript is not seen, and the
report says so; a page whose head was only partly read, a compressed page and a non-HTML page are each
reported as a note, never a silent pass. Suggested severity `warn`. On its first real run it found a
genuine `noindex` URL in MDN's own sitemap. `sitemap-url-status` now reads the same shared sample
(no extra requests to your site) and reports exactly what it did before.

**Internal/dev**: full 9-stage pipeline for the shared page sample, which is a new capability:
`SitemapDocuments` now also requests the sampled URLs once each via the new `safeFetchPrefix` (reads at
most 64 KiB of a 2xx HTML body, `Accept-Encoding: identity`, headers as an allowlist with every
`X-Robots-Tag` occurrence, resolves rather than errors at the byte cap), reduces each page to signals with
`parse5` (new declared dependency, already in the tree; raw HTML is never stored), and records `urlSample`
in the artifact. `sitemap-url-status` was refactored onto it behind a characterization test whose
expected values were captured before the change. Additive `noindexFor` in `robots-directives.js` handles
user-agent-scoped directives (the existing parser read `googlebot: noindex` as a directive named
`googlebot`). **A real finding during the build**: `parse5` is quadratic in block-element nesting (64 KiB
of `<div>` = 1.6 s, synchronous); the parser is now given only the text up to the 2,000th `<`
(worst of 121 element names: 92 ms). The security review ran every attack on the new fetch path
(slow-loris, never-ending and mislabelled-gzip bodies, 300 aborted requests, 20 same-origin evasion URLs)
and found no `high` or `critical` issue; the one open item is that the gatherer now has a ~135-145 s
worst case and still no overall time budget (Finding 6, with Finding 3). See
`docs/qa/sitemap-indexability.md` and `.ai-agents/state/security-findings.md`.

No `.lighthouserc.js` migration note needed: no new config keys.

### gatherer total time budget (2026-10-01, closes the last open security findings)

**User-facing**: a run against a slow or unresponsive site is now bounded. The sitemap gatherer used to
have no overall deadline (worst case about 105 s for robots.txt and the sitemap files, plus up to 30 s
for the page sample). Discovery and all sitemap files now share one **40 s** budget, and the page sample
keeps its own **30 s**: measured worst case, a site where four sitemaps and every listed page hang,
**70 s**. When the budget runs out the remaining files are not fetched and the audits say "only the first
N sitemap files were checked" (the same truncation as the 10-file cap), never a silent pass. The tradeoff:
a very large sitemap on a slow server can now be truncated where it was once read in full.

**Internal/dev**: `LIMITS.DOCUMENTS_BUDGET_MS` (40 s) and `LIMITS.MIN_REQUEST_MS` (1 s) in
`sitemap-parse.js`; a small `createBudget` in the gatherer gives each request `min(its limit, time left)`
so the phase cannot overrun. Injectable (`documentsBudgetMs`, `now`) for tests, with fake-clock tests and
a real hanging-server test. Security-findings housekeeping in the same change: Findings 1 and 2 marked
merged (`ad8557c`, `7ec20c4`), Finding 4 resolved by the private-network opt-in, Findings 3 and 6
resolved here. **No open findings remain.**

## transport-security (Phase 5, items 1-3, 2026-10-01)

### Mixed content, HSTS quality and certificate expiry audits

**User-facing**: three new audits in the `seo-extended` category (34 in total), all read only what
Lighthouse already collects, so they make **no request of their own** to your site, and all are not
applicable on a plain `http://` page.

- **`mixed-content`** fails when an HTTPS page loads **active** content over `http://` (scripts,
  stylesheets, frames, fetch/XHR, fonts, forms) or anything the browser blocked. Passive content that
  Chrome auto-upgraded (images, audio, video) passes and is listed as a note with a plain-English "what it
  means" column. Lighthouse's own `is-on-https` fails that same page; this one separates the two.
- **`hsts-quality`** fails on a missing header, `max-age` missing or under one year, `max-age=0`, or
  `preload` without its prerequisites. Core's `has-hsts` is informative and never fails.
- **`ssl-certificate-expiry`** scores 1 with more than 15 days left, **0.5 with 15 days or fewer (plus a
  warning)**, 0 when expired or not yet valid. Because `lhci assert` has no minimum-value check, the 0.5 is
  what lets CI tell "expiring soon" from "fine"; to fail only on expiry but be told at 15 days, use an
  `assertMatrix` with two entries (error at `minScore: 0.5`, warn at `minScore: 1`), documented and checked
  with a real `lhci assert`. Chrome refuses an already-expired certificate and Lighthouse then stops, so the
  0 score is reachable only when certificate errors are ignored; in practice this is the early warning.

Suggested severities (README): `mixed-content` error, `hsts-quality` warn, certificate as above.

**Internal/dev**: pure logic and typedefs in `src/lib/transport-security.js` (61 + 5 tests), input
resolution split into `transport-security-sources.js` (it imports `MainResource`/`NetworkRecords`, which
cannot load under Jest, the same split as `robots-sources.js`); the audit files are thin. The certificate
is read from the raw `Network.responseReceived` event's `securityDetails`, since Lighthouse's parsed
network record drops it. No new dependency, no config key, no environment variable.

**Security**: one `low` finding found by running an attack and fixed in the same sitting: site-controlled
strings (insecure URLs, header values, certificate names) were echoed without a bound, so a page with 60
requests of 200 KB URLs produced a 10 MB audit result. They are now cut (URLs at 1,000 characters,
other text at 200); the same attack gives 60 KB. Markup in a certificate subject was verified to render as
plain text in Lighthouse's report. No `critical` or `high` findings.

No `.lighthouserc.js` migration note needed: no new config keys.

## soft-not-found (Phase 5 item 5, 2026-10-01)

### Soft-404 check

**User-facing**: a new `seo-extended` audit, **`soft-not-found`**, requests two made-up URLs on your site
(a top-level path and a nested `.html` path) and fails if either is answered as a normal page, or redirects
to a same-origin page that returns 200, instead of 404 or 410 (a soft 404: catch-all routes and single-page
apps are the usual cause, and search engines index the junk URLs). One redirect hop is followed, status only;
a redirect to another origin is never requested; a server error is shown but does not fail. It sends up to
four status-only requests (they show as 404s in your logs) through the SSRF-protected fetch, so auditing
`localhost` needs `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`; without it the audit is not applicable and the run
warns. Suggested severity: `warn`. The audit id is `soft-not-found`, not `soft-404`: an id with a hyphen
followed by a digit makes `lhci assert` fail on a phantom audit (an LHCI quirk found in live QA).

**Internal/dev**: gatherer `Soft404Probe` (`src/gatherers/soft-404-probe.js`), pure logic in
`src/lib/soft-404.js`, thin audit. A guard test fails on any registered audit id matching `/-\d/`, and the
rule is in `.ai-agents/prompts/lighthouse-conventions.md`. No new dependency, config key or environment
variable. Built in lightweight mode (see `docs/phases/phase-5-crawlability.md`).

No `.lighthouserc.js` migration note needed: no new config keys.

## url-variants (Phase 5 item 4, 2026-10-01)

### Redirect consistency, chain length and loops for the URL's own forms

**User-facing**: three new `seo-extended` audits (38 in total) that share one probe of the audited page's
other forms: `http://` of the same host, and the host with `www` added or removed over `http` and `https`,
always with the page's own path and query.

- **`url-variant-consistency`** fails when another form serves the page directly (the same content at two
  URLs), ends at a different origin, ends in an error, or drops the path/query. A temporary redirect (302)
  and a form that does not exist are notes, not failures. Suggested severity: `warn`.
- **`redirect-chain-length`** fails when a form takes more than 2 redirects (a geo/locale hop counts) or is
  still redirecting after 5. Suggested: `warn`.
- **`redirect-loop`** fails when a redirect returns to a URL already visited. Suggested: `error`.

Redirects are followed by hand and only to the page's own host variants; any other target is recorded and
never requested. At most three variants x 5 hops, 5 s per request, 20 s per variant, through the
SSRF-protected fetch; the requests show in your site's logs. `www` is toggled only for an apex or `www.`
host (not `app.example.com`: wildcard DNS would answer and be reported as a duplicate). Nothing is probed for
an IP, `localhost`, a non-default port or a non-HTTPS page, where the audits are not applicable and say why.
Redirects of the site's links wait for the crawler.

**Internal/dev**: gatherer `UrlVariants`, pure logic in `src/lib/url-variants.js` (50 tests), three thin
audits; built in lightweight mode after a short design conversation (probe the audited path, temporary
redirects as notes, three audits on one gatherer). No new dependency, config key or environment variable.

No `.lighthouserc.js` migration note needed: no new config keys.

## indexability (Phase 6, 2026-10-01)

### Indexability verdict and contradiction detection

**User-facing**: two new `seo-extended` audits (40 in total) built on one decision tree over the signals a
search engine weighs for the audited page: HTTP status, robots.txt (Googlebot and Bingbot), meta robots and
`X-Robots-Tag` (including crawler-scoped values), the canonical, and the amount of visible text.

- **`indexability-verdict`** (informational, never fails) shows the five steps and a plain-English verdict:
  Indexable, Indexable but canonical elsewhere, Blocked by robots.txt, Not indexable (noindex), or Not
  indexable (HTTP status). A deliberate noindex is legitimate, so it never fails.
- **`indexability-conflicts`** fails when signals contradict each other: noindex that robots.txt hides from a
  crawler, noindex together with a canonical to another URL, robots.txt blocking a page whose canonical points
  elsewhere, a canonical on an error page, and a bad canonical target. Each row says why it matters and what to
  do. Suggested severity: `warn` first, then `error`.

When the canonical points to another URL on the same site, **one** status request is made to it (SSRF-protected,
first 64 KiB, 5 s, no redirect followed; `LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies) to catch a canonical that
redirects, errors, is noindex, is blocked by robots.txt, or chains to yet another canonical. A cross-origin
canonical is never requested. Limits: a canonical sent only in an HTTP `Link` header and anything a script adds
after load are not seen. **Error pages**: Lighthouse stops on a 4xx/5xx main document, so the HTTP-status
verdict and the error-page conflict need `ignoreStatusCode: true` under `ci.collect.settings`.

**Internal/dev**: gatherer `IndexabilitySignals`, pure logic in `src/lib/indexability.js` (44 tests with the
gatherer's), input resolution in `indexability-sources.js` (imports `MainResource`, same split as
`robots-sources.js`), two thin audits; `toSampledPage` is now exported from `sitemap-url-sample.js` (additive).
No new dependency, config key or environment variable.

No `.lighthouserc.js` migration note needed: no new config keys.

## site-crawler (Phase 7 item 0, 2026-10-01)

### A bounded site crawler for the cross-page audits

**User-facing**: a new gatherer, `SiteCrawl`, crawls the audited site inside the normal Lighthouse run so the Phase 7 duplicate
audits (coming next) can compare pages. It reads the audited page, **its own internal links** and **the sitemap's URLs** (one
level: it does not follow the links of those pages), same origin only, from server HTML, up to 50 pages, honouring robots.txt, and
keeps per page the title, description, canonicals, robots signals, the first `<h1>` texts, a hash of the visible text and the page's
links (never raw HTML). A new informational audit, **`crawl-coverage`** (41 audits in the fork), shows what was crawled, blocked and
skipped. `lhci collect` runs every Lighthouse run as its own process, so a snapshot cache on disk makes several URLs and runs of one
collect crawl the site **once** (verified: a collect with 2 URLs x 2 runs requested each crawled page exactly once). The cache is used
only from a directory owned by you with no group or other access.

It is **on by default** and costs up to about 100 requests and up to 120 s on a cold cache, inside whichever run first needs it;
Lighthouse skips it when no selected audit needs it (a run limited to core categories does not crawl). Environment variables (no
`.lighthouserc.js` keys): `LHCI_SEO_CRAWL` (`0` or `false` switches it off), `LHCI_SEO_CRAWL_MAX_PAGES` (default 50, 1 to 200),
`LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS` (120, 10 to 600), `LHCI_SEO_CRAWL_RESPECT_ROBOTS` (`0` or `false` ignores robots.txt, for your
own staging), `LHCI_SEO_CRAWL_CACHE_DIR`, `LHCI_SEO_CRAWL_CACHE_TTL_SECONDS` (600, `0` disables). Auditing `localhost` needs
`LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`, as everywhere. Limit: it reads server HTML, so a script-built site (or a server that answers
non-browser requests differently, as `example.com` does) can look like empty shells; `crawl-coverage` says so. Do not assert on
`crawl-coverage`: it is informational.

**Internal/dev**: new modules `crawl-snapshot.js`, `crawl-extract.js`, `crawl-cache.js`, `crawler.js`, `crawl-coverage.js`, the gatherer
and the audit; one new dependency, `htmlparser2@^6.1.0` (already in `yarn.lock`); an additive, validated `userAgent` option on
`safeFetchPrefix`. **Why `htmlparser2`**: `parse5` took 109 s for one 512 KiB page of nested `<div>`; `htmlparser2` takes 53 ms (every
hostile shape is asserted under 2 s). Built through the full 9-stage pipeline.

**Security**: no `critical`, `high` or `medium` finding. One `low` (Finding 8): the crawler's robots.txt and sitemap requests
did not send its user-agent; fixed with the same validated `userAgent` option on `safeFetchBytes`. Found and fixed while building: Node's recursive `mkdir` hangs forever on an uncreatable cache path, and a
quadratic loop on repeated `<body>` tags. Live attacks (hostile servers, planted and symlinked cache files) are in `security-findings.md`.

No `.lighthouserc.js` migration note needed: no new config keys.

## 2026-10-02 — Phase 7 cross-page audits

Five new audits (46 in the fork) that compare the pages the site crawl reached. They make no extra requests and read server HTML.

- **`duplicate-titles`, `duplicate-descriptions`** (scored): fail when another crawled page has the same title or meta description
  as the audited page (equal after trimming and ignoring case; empty values never count).
- **`thin-content`** (scored): fails when the audited page has under 200 words of visible text; the text-to-HTML ratio is shown, not
  judged; other thin pages are listed. Not applicable for script-built or oversized pages.
- **`canonical-conflicts`** (scored): fails when the audited page is a bad canonical target for other pages (error, redirect, noindex,
  chain, loop, or the shared target of pages with different content). Its own canonical target stays with `indexability-conflicts`.
- **`duplicate-content`** (scored): fails when another crawled page has exactly the same visible text (and neither declares a canonical
  to the other); pages under 50 words are not compared; trailing-slash and query duplicates are noted.

Add the ones you want to your `assertions` yourself, e.g. `'duplicate-titles': ['error', {minScore: 1}]`; none is in the shared presets.
Limit: they judge only the pages the crawl reached (the audited page, its links and the sitemap URLs), so read `crawl-coverage` first.
**Security**: one `low` finding (a quadratic slash regex in `duplicate-content`, 0.87 s worst case), fixed. No `.lighthouserc.js` migration.

## 2026-10-05 — Phase 8 item 0: the crawler follows links to depth 3

The site crawler (`SiteCrawl`) now builds the site's **link graph**, which the Phase 8 audits will read. It also starts from the **homepage**, follows
same-origin links **breadth-first for up to 3 hops** (`LHCI_SEO_CRAWL_MAX_DEPTH`, 1 to 5), and stores per page its depth, its internal links with
**anchor text** and `nofollow`/`sponsored`/`ugc` flags, up to 20 external links (never requested), its `rel=next/prev` pagination links, the sitemap's URL
list, and whether the page cap, the depth bound or the time budget cut the crawl. Raw HTML is still never stored.

**What changes for you**: the cross-page audits from Phase 7 (`duplicate-titles`, `duplicate-descriptions`, `thin-content`, `canonical-conflicts`,
`duplicate-content`) now see more, and deeper, pages, so their results can change on a site with more than a handful of pages. A cold crawl sends up to
about 150 requests. Files (`.png`, `.pdf`, `.js`) are not requested, and at most 5 query-string variants of one path are. Cached snapshots from before are
ignored once and the site is crawled again. `crawl-coverage` now has a Depth column and says when the page cap or the depth bound cut the crawl.

**Security**: one `low` finding, open and accepted (Finding 10): a hostile site with very long link URLs can make the snapshot exceed the 16 MiB cache cap
(the cache is then skipped and each run crawls again). No new request goes to another origin (a spy server received none). No `.lighthouserc.js`
migration; one new environment variable.

## 2026-10-05 — Phase 8 items 1 and 2: link-graph audits

Four new scored audits (50 in the fork) that read the link graph of the crawl, with no extra request. Each judges the audited page and lists other
offending crawled pages without failing on them.

- **`dead-end-pages`**: fails when the page has no followable internal link to a different page (nofollow and self links do not count).
- **`internal-link-counts`**: fails with more than 150 internal links on the page, or exactly one crawled page linking to it (none at all is `orphan-pages`).
- **`orphan-pages`**: fails when no crawled page links to the page. Judged only when the crawl saw the whole site: otherwise not applicable, naming the limit
  (page cap, depth bound, time budget, blocked or unreadable pages). On a site bigger than the crawl's cap it is usually not applicable until you raise
  `LHCI_SEO_CRAWL_MAX_PAGES` or `LHCI_SEO_CRAWL_MAX_DEPTH`.
- **`crawl-depth`**: fails when the page is more than 3 clicks from the homepage along followable links. A depth within the limit is always reliable; a larger one is
  judged only on a complete crawl.

Add the ones you want to your `assertions` yourself, e.g. `'orphan-pages': ['warn', {minScore: 1}]`; none is in the shared presets. They read server HTML, so a
script-built page is not applicable. **Security**: no new finding. No `.lighthouserc.js` migration.

## 2026-10-05 — Phase 8 item 3: internal link checks

Three new scored audits (53 in the fork) that judge **every internal link on every crawled page**. They close the three link checks deferred from Phase 5.

- **`broken-internal-links`**: fails when a link points at a page that answers 4xx or 5xx, or does not answer.
- **`redirecting-internal-links`**: fails when a link points at a URL that permanently redirects once (301 or 308). A temporary redirect (302, 303, 307) is listed with a note
  and does not fail.
- **`internal-redirect-chains`**: fails when a link points at a URL that redirects two or more times, or in a circle.

**New requests**: so that all of the audited page's links are covered, up to **100 of its own links that the crawl did not read** get a status-only check (same origin, robots.txt
honoured, no body read, a 30 s budget) in every Lighthouse run, up to about 300 requests in the worst case. `LHCI_SEO_CRAWL_MAX_LINK_CHECKS=0` switches it off (the audits then judge
only links to pages the crawl read, and say how many targets that leaves unchecked). `crawl-coverage` says how many links were checked.

**Fix to the crawler (since Phase 7)**: URLs that the crawl time budget never let it request were recorded as pages that "did not answer"; they are now recorded as skipped
("not checked"), so `crawl-coverage` and the audits no longer count them as errors. **Security**: no new finding; every request is same-origin and robots-aware (a spy server on
another origin received none). Add the audits you want to your `assertions` yourself; none is in the shared presets. No `.lighthouserc.js` migration; one new environment variable.

## 2026-10-05 — Phase 8 item 4: anchor-text audits

Two new scored audits (55 in the fork) that read the anchor text the crawl stores, with no extra request. Each judges the audited page and lists other crawled pages without failing on them.

- **`anchor-text-diversity`**: fails when one exact anchor is 60% or more of at least 5 editorial internal links to the audited page. Site-wide navigation (a link with the same anchor on 80% of the
  crawled pages) and links with no text are left out; the homepage is not judged; it counts the crawled pages only.
- **`descriptive-anchor-text`**: fails when the audited page has an internal link with a generic anchor ("click here", "read more", "here", "learn more", ...) or none (no text, no image alt, no
  `aria-label` or `title`).

An icon link with an `aria-label` or `title`, or an image with alt text, is no longer called empty. Add the audits you want to your `assertions` yourself, e.g. `'descriptive-anchor-text': ['warn',
{minScore: 1}]`; none is in the shared presets. **Security**: no new finding. No `.lighthouserc.js` migration.

## 2026-10-05 — Phase 8 item 5: pagination audits

Three new scored audits (58 in the fork) that read the `rel=next` / `rel=prev` links the crawl stores. Each judges the audited page and lists other crawled pages without failing on them;
a page with no pagination links is not applicable.

- **`pagination-links`**: fails when a `rel=next` or `rel=prev` target is broken, is the page itself, or does not link back, or the `rel=next` chain loops. The audited page's own targets are
  status-checked even when the crawl did not read them.
- **`paginated-canonical`**: fails when a paginated page's canonical is another page of its series (page 1 included). A canonical outside the series (a view-all page) passes with a note.
- **`pagination-trap`**: fails when the page's path has more than 5 numbered query-string variants known to the crawl and the series was still going. It uses only what the crawl saw: a
  chain that only offers "next" is followed as far as `LHCI_SEO_CRAWL_MAX_DEPTH` reaches (3 by default), so raise it to 5 to catch those, and a long but finite series looks the same.

Add the ones you want to your `assertions` yourself; none is in the shared presets. **Security**: no new finding. No `.lighthouserc.js` migration.

## 2026-10-05 — Phase 8 item 6: broken external links (Phase 8 complete)

One new scored audit (59 in the fork): **`broken-external-links`** fails when an external link on the audited page points at a page that is gone (404 or 410) or a host that does not exist or
refuses connections. A 5xx, a timeout or a TLS error is listed but never fails; a 401, 403, 429 or 999 is not judged (many sites block link checkers).

**This is the first audit that sends requests to other people's sites, and it is on by default.** Each run checks up to **20** of the audited page's external links: at most 2 per host, status only (no body read),
the crawler user-agent, 3 redirect hops, a 15 s budget; third-party robots.txt files are not fetched. **A link to a private or reserved address is never requested**, even with `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` (a new
strict fetch: that opt-in is for your own site only). Set `LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS=0` to switch it off (the audit is then not applicable); `crawl-coverage` says how many links were checked.
**Security**: no new finding; the new request surface was reviewed with attacks run against the real fetch path (see `security-findings.md`). Add the audit to your `assertions` yourself; it is not in the
shared presets. No `.lighthouserc.js` migration; one new environment variable.

**Phase 8 as a whole** (see its entries above): the crawler follows links to depth 3 from the homepage; link-graph audits (`dead-end-pages`, `internal-link-counts`, `orphan-pages`, `crawl-depth`); internal link checks
(`broken-internal-links`, `redirecting-internal-links`, `internal-redirect-chains`); anchor text (`anchor-text-diversity`, `descriptive-anchor-text`); pagination (`pagination-links`, `paginated-canonical`,
`pagination-trap`); and this one. 17 audits' worth of new reading of the site, 13 new audits.

<!-- Appended by Agent 09 after each feature. Cleared into docs/changelog/{version}.md on a
/write-changelog --release run. -->

## 2026-10-05 — url-quality-audits (Phase 9)

Seven new audits in `seo-extended`: `url-length` (over 115 characters of path and query), `url-query-parameters` (over 3), `url-session-tracking` (a session ID fails; tracking parameters are a note), `url-encoding` (repeated slashes, broken or double percent-encoding), and `url-case-variants`, `url-trailing-slash-variants` and `url-normalization` (the crawl holds two live URLs that are one page, with no single canonical). The first four also work with the crawl switched off. No new request, no new environment variable, no `.lighthouserc.js` migration; add the audits to your `assertions` yourself.

**Bug fix that affects Phases 7 and 8**: when one `lhci collect` audited several URLs of the same origin, the later URLs reused the first URL's cached crawl and the cross-page audits (duplicate titles, thin content, link counts, anchor text and the rest) could judge the *first* page instead of the one being audited. They now judge the right page.

## 2026-10-05 — image-audits (Phase 10)

Seven new audits in `seo-extended`, all on the audited page and all binary: `image-alt-quality` (a file name, a placeholder, over 125 characters, or the same alt on 3 or more images), `image-filename-quality` (IMG_1234, numbers, hashes, generic words; CSS backgrounds included), `image-lazy-above-fold` (any `loading="lazy"` image in the first screen), `image-dimensions-attributes`, `image-oversized` (more than 2x wider than shown), `image-legacy-formats` (JPEG/PNG/GIF over 10 KiB) and `broken-images` (4xx, 5xx or no response). Four overlap Lighthouse core audits with stricter, simpler thresholds, by choice. One new gatherer (`ImageAltText`). No new request, no new environment variable, no `.lighthouserc.js` migration; add the audits to your `assertions` yourself.

## 2026-10-05 — js-rendering-audits (Phase 12)

Seven new audits in `seo-extended`, comparing what a crawler reads (the raw HTML) with the DOM after JavaScript: `js-head-signals` (title, description, canonical or noindex missing or different), `js-internal-links` (over 20% of links only after JavaScript), `js-visible-content` (over half the words only after JavaScript), `raw-rendered-diff` and `rendering-mode` (informational: a side-by-side, and server-rendered / client-rendered / hybrid with framework signs), `hydration-errors` (React, Vue, Angular mismatches in the console) and `device-content-parity` (a mobile and a desktop user-agent get different titles, links or text). Two new gatherers (`RenderedHtml`, `DeviceFetches`). Excessive DOM size stays with Lighthouse core `dom-size`.

**New request: `device-content-parity` fetches the audited page twice per run** (a mobile and a desktop user-agent, each ending in `lhci-seo-audits/1.0`, 512 KiB, no redirect followed, the audited URL only). Set `LHCI_SEO_DEVICE_PARITY=0` to switch it off (the audit is then not applicable). No `.lighthouserc.js` migration; add the audits to your `assertions` yourself.

## 2026-10-05 — performance-audits (Phase 13)

Three new audits in `seo-extended`: `core-web-vitals-field` (real-visitor Core Web Vitals from Google's Chrome UX Report; fails only when LCP, INP or CLS is "poor" at the 75th percentile by Google's published thresholds), and two informational reports, `render-blocking-report` and `request-weight-report`. One new gatherer (`FieldData`). **`core-web-vitals-field` is off unless you set `LHCI_SEO_CRUX_API_KEY`; when set, each run sends the audited page's origin and path (no query string, never a private or non-public address) to Google, with the key in a request header and never in the report.** Not applicable without a key or when CrUX has no data. No `.lighthouserc.js` migration; add the audits to your `assertions` yourself.

## 2026-10-05 — hreflang-audits (Phase 11)

Seven new audits in `seo-extended` for pages that declare `hreflang` (all not applicable otherwise): `hreflang-codes` (invalid or misspelled codes such as `en-UK`, a page that does not list itself, one value pointing at two URLs), `hreflang-return-links` (an alternate that has hreflang tags but none naming this page), `hreflang-alternate-status` (an alternate that is gone, redirects or is noindex), `hreflang-canonical` (a canonical that points at another language version, or a canonical that differs from the hreflang URL), and three informational audits (`hreflang-x-default`, `hreflang-sitemap-consistency`, `hreflang-locale-meta`). One new gatherer (`HreflangData`) and a small extension to the sitemap gatherer (the `xhtml:link` alternates of the audited URL).

**New requests: up to 10 alternate versions named by the page are requested per run** (the first 128 KiB, one request at a time per host; alternates on another host use the strict public-only fetch, so a private address is never requested). `LHCI_SEO_HREFLANG_MAX_CHECKS` sets the number (default 10, at most 25); `0` switches the requests off and the audits that need them become not applicable. Bot protection (401/403/429), server errors and timeouts on an alternate are notes, never failures. No `.lighthouserc.js` migration; add the audits to your `assertions` yourself.

## 2026-10-05 — content-audits (Phase 14)

Five new audits in `seo-extended`, all reading the page's own text with **no request**: `placeholder-content` (fails on lorem ipsum, a template prompt such as "your text here", or an unfilled template tag), `content-dates` (fails when the declared published and modified dates contradict each other, are in the future, or disagree between meta tags and JSON-LD), and three informational audits: `readability-score` (Flesch reading ease and grade, English pages only), `hidden-text` (words hidden by a tiny font, off-screen positioning or matching colours; accordions, `display:none` and screen-reader text are not counted) and `keyword-alignment` (the words the title, first h1 and URL share). One new gatherer (`PageContent`). No new environment variable, no `.lighthouserc.js` migration; add the audits to your `assertions` yourself.

## 2026-10-05 — ai-search-audits (Phase 15)

Four new **informational** audits in `seo-extended` (they never score or fail; there is no official rule for this area): `ai-crawler-summary` (15 AI crawlers and tokens: whether robots.txt allows each on the page, and whether its own rule or the wildcard decided it), `answer-structure` (how easy the page is to quote: text in the HTML, landmarks, heading outline, question headings with short answers, lists and tables, Q and A markup, `llms.txt`), `author-entity-signals` (declared author and publisher, `sameAs` links, logo, site-name consistency) and `amp-check` (an AMP page or `rel=amphtml` link; for a linked version, one request to see whether it loads and names the page as canonical). Two new gatherers (`ContentStructure`, `AmpPage`). **`amp-check` makes one request to the linked AMP version per run** (same safe-fetch policy as the hreflang requests); `LHCI_SEO_AMP_CHECK=0` switches it off. No `.lighthouserc.js` migration; add the audits to your `assertions` yourself (informational audits cannot be asserted on score).


## 2026-10-06 — calibration of phases 11 and 13–15

Fewer false positives in six scored audits, found by the second review. `hreflang-alternate-status` and `hreflang-return-links` no longer fail on the `x-default` URL (a redirecting language chooser, or a home page with its own hreflang set). `hreflang-codes` ignores tracking parameters when checking that the page lists itself, and accepts a three-letter code with no two-letter form (`fil`, `yue`, `haw`), as Lighthouse core does. `content-dates` reads only the page's main entity, so a Review or Event in the same page no longer contradicts the Article, and `<meta name="date">` is shown but not judged. `placeholder-content` ignores code samples (`pre`, `code`, `kbd`, `samp`); the `PageContent` gatherer has one new field, `proseText`. `core-web-vitals-field` no longer fails a page for poor whole-site data when CrUX has none for the URL. Informational: `render-blocking-report` counts a bare media-query stylesheet and says it is about page speed, `hidden-text` ignores carousel slides clipped by their container. No migration.

## 2026-10-06 — calibration, round 2

`llms-txt-structure` is now **informational** (llms.txt is an unratified proposal); remove it from `assertions` if you had it (informational audits cannot be asserted on score). The crawler stores at most 40,000 characters of link URLs per page, which closes security Finding 10; normal pages are unaffected. Absolute time limits in the test suite were loosened so a busy CI runner no longer fails them. No migration.

## 2026-10-06 — calibration, Part A fixes (first review, section 3.1)

Four scored audits were wrong, not just strict. `image-lazy-above-fold` no longer reports a lazy carousel slide that sits to the right of (or left of) the screen. `broken-internal-links` does not judge 401, 403 and 429 (bot protection or a rate limit) and says how many it skipped. `js-head-signals` now fails only when JavaScript changes the noindex or the canonical; a title or description that JavaScript sets is a note (its title changed to "Canonical and robots are the same without JavaScript"). `structured-data-schema-properties` fails only on properties Google requires (Article has none; a Product needs a name plus offers, review or aggregateRating; a Recipe needs name and image) and lists recommended ones as notes; the ruleset gains `recommended` and `a|b` alternatives. Existing assertions keep working; some pages that failed now pass.

## 2026-10-06 — calibration: tiers and the remaining first-review items

**Three tiers.** 19 audits are now informational and no longer fail: `thin-content`, `crawl-depth`, `internal-link-counts`, `anchor-text-diversity`, `url-query-parameters`, `duplicate-descriptions`, `pagination-links`, `pagination-trap`, `url-normalization`, `meta-description-identical-to-title`, `robots-txt-sitemap-declared`, `robots-txt-rule-conflicts`, `sitemap-duplicate-urls`, `favicon-presence`, `hsts-quality`, `manifest-icons`, `image-filename-quality`, `image-legacy-formats` and `llms-txt-structure` (lhci cannot assert on informational audits: remove them from your `assertions`). Seven audits became a **warning** (score 0.5, weight 0.5): `document-h1-count` (zero h1; several are now a note), `redirecting-internal-links`, `internal-redirect-chains` (a loop still fails), `redirect-chain-length` (still fails at the hop limit), `descriptive-anchor-text`, `js-internal-links`, `js-visible-content`. New file `src/recommended-assertions.json` asserts the error tier at `error` and the warn tier at `warn`.

**Thresholds.** `url-length` notes above 115 characters and fails only above 2,000; `document-title-quality` flags titles under 3 characters (was 10); `image-oversized` uses 3x and notes images from another site; `image-dimensions-attributes` accepts CSS sizes and aspect-ratio (the core rule); `broken-images` and `image-alt-quality` demote third-party and convention-only findings (125 characters, repeated alt) to notes; `duplicate-titles` skips canonicalised and paginated pairs; `device-content-parity` notes missing mobile links; `open-graph-completeness` needs only og:title and og:image; `open-graph-canonical-match` notes a query-string-only difference; `twitter-card-completeness` notes a missing twitter:card.

**Structured data.** Every type's required list was re-checked against Google's live documentation; `BreadcrumbList` may appear several times; the FAQ and HowTo eligibility text carries Google's nuance. Scored audits: 57, informational: 42 (99 in all). README paths for `configPath` now say `src/lighthouse-config.js`.

## 2026-10-06 — calibration: real-site spot check and the last review items

Found by running the audits on five real sites (MDN, BBC News, apple.com, ikea.com, Wikipedia). **`structured-data-json-ld` is now not applicable when a page has no JSON-LD** (it scored 0, which would have failed a healthy page; it fails only on invalid JSON or missing `@context`/`@type`). `document-title-quality` no longer counts an inline SVG's `<title>` as a second document title. `url-variant-consistency` does not judge a chain that ends in 401, 403, 429 or a 5xx (bot protection; Wikipedia answered the probe with 403). `sitemap-valid` treats a timeout, a network error, 401, 403, 408, 429 and a 5xx on a sitemap as a note, not a failure. `image-oversized` uses 3.5x (a 3x asset for a 3x phone is normal). The Open Graph and Twitter audits also read `og:*` tags written with `name=` (MDN does). `numericValue` is exposed by `thin-content` (words), `crawl-depth` (clicks), `internal-link-counts` (links on the page), `url-length` (characters), `url-query-parameters` (count), `redirect-chain-length` (longest chain) and `ssl-certificate-expiry` (days left), so `maxNumericValue` assertions work. 17 audits that read navigation-only artifacts now declare `supportedModes: ['navigation']`. The AI crawler list was checked against the vendors' pages (the user-initiated fetchers ChatGPT-User and Perplexity-User may ignore robots.txt, and the table says so). The README lists the requests sent to the audited site per run.

## 2026-10-06 — calibration, round 4

`hreflang-codes` now checks the script subtag (Latn, Hant, Cyrl) against the runtime's locale data instead of accepting any four letters. `image-filename-quality` and `image-legacy-formats` treat images served by another site as notes. The seven image audits, `duplicate-titles`, `duplicate-descriptions`, `descriptive-anchor-text` and `broken-internal-links` expose `numericValue` (the number of offenders), so `maxNumericValue` assertions work. No migration.

## 2026-10-06 — calibration, round 5 (ten more real sites)

`url-variant-consistency` fails only a redirect chain that ends gone (404 or 410); a 401, 403, 406, 429 or 5xx at the end is a note (the Guardian answered the probe with 406). `indexability-conflicts` no longer reports a canonical target that answered 401, 403, 406, 429 or 5xx (LEGO answered 403 to the probe); 404 and 410 still count. `image-lazy-above-fold` ignores a lazy image that starts below 75% of the first screen. `rendering-mode` recognises Next.js app-router pages (`/_next/static/`, `__next_f`). `ai-crawler-summary` lists 19 crawlers (adds `OAI-AdsBot`, `Amzn-SearchBot`, `Amzn-User`, `Meta-ExternalFetcher`) with vendor-confirmed purposes; the user-initiated fetchers may ignore robots.txt. No migration.

## 2026-10-06 — docs only

`docs/phases/phase-1-page-metadata.md` now says the crawler exists and the exact-match duplicate audits were built (Phase 7); the roadmap's Phase 16 is the summary layer, not the crawler. No code change.

## 2026-10-06 — Bytespider removed

`ai-crawler-summary` no longer lists `Bytespider` (ByteDance publishes no documentation to check it against); it now lists 18 crawlers, all confirmed against vendor pages. No migration.

## 2026-10-06 — A3 workflow

A manual workflow, `.github/workflows/seo-audit.yml`, runs the fork's audits on a GitHub runner in two ways (the fork's own `lhci` and a global `@lhci/cli@0.15.x`) and writes a summary; see `docs/open-items.md`, A3. No change to the audits.

## 2026-10-06 — summary-command (Phase 16)

New command `node packages/seo-audits/src/summary/cli.js <folder>`: reads the `lhr-*.json` files `lhci collect` wrote and prints a summary of the fork's audits: a score and grade per category and overall (error-tier audits weigh 3, warn-tier 1, partial scores count as half, informational audits are left out), the issues ranked by tier and then by how many items each found, and each audit's own explanation as fix guidance. `--compare <earlier folder>` adds what is new, fixed and still failing since an earlier run; `--format json`, `--top N`, `--guidance N` and `--out file` are options. It reads local files only, always exits 0 on success (gating stays with `lhci assert`) and 2 on bad usage. No new dependency or environment variable.

## 2026-10-06 — A3 result

The A3 workflow ran on a GitHub runner (web.dev, Node 18): both install paths (the fork's own `lhci` and a global `@lhci/cli` 0.15) ran all 57 scored audits with identical results; a 71 s run. The workflow now records its elapsed time even when assertions fail. No change to the audits.
