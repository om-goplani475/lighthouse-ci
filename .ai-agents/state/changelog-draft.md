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

<!-- Appended by Agent 09 after each feature. Cleared into docs/changelog/{version}.md on a
/write-changelog --release run. -->
