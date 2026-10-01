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

<!-- Appended by Agent 09 after each feature. Cleared into docs/changelog/{version}.md on a
/write-changelog --release run. -->
