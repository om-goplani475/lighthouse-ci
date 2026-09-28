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

<!-- Appended by Agent 09 after each feature. Cleared into docs/changelog/{version}.md on a
/write-changelog --release run. -->
