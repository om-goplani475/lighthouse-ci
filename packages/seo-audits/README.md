# @lhci/seo-audits

Custom Lighthouse audits added by this fork, kept as their own package so upstream
(`google/lighthouse-ci`) merges stay clean — see `../../CLAUDE.md` and `../../AGENTS.md` for the full
rationale and the agent pipeline this package was built through.

## What's in here

- **`structured-data-json-ld`** — validates every `<script type="application/ld+json">` block on a
  page: it must be parseable JSON and include `@context`/`@type`. Lighthouse's own built-in
  `structured-data` audit is a manual placeholder (it just tells you to run an external tool); this
  one actually checks it. See `docs/feature-specs/structured-data-validation.md` in the repo root for
  the full spec and rationale.
- **`structured-data-schema-properties`** — for JSON-LD blocks whose `@type` is one of the 12 types
  Google documents rich-result guidance for (`Product`, `Article`, `BreadcrumbList`, `Recipe`,
  `Review`, `Event`, `JobPosting`, `VideoObject`, `Organization`, `LocalBusiness`, `FAQPage`, `HowTo`),
  checks that Google's required/recommended properties are present, including specific nested
  sub-object properties (e.g. `Product.offers.price`, `Event.location.address`). Rule content lives as
  versioned data under `rules/`, not hardcoded in the audit — see
  `docs/architecture/structured-data-rule-engine.md` for why, `docs/feature-specs/structured-data-rule-engine.md`
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

This adds both `structured-data-json-ld` and `structured-data-schema-properties` on top of
Lighthouse's default audits (via `extends: 'lighthouse:default'` — see `src/lighthouse-config.js`),
in a new `seo-extended` category, without replacing or altering any of Lighthouse's own defaults.

### Assertion severity

Neither audit is part of this fork's shared `all`/`recommended` presets (`packages/utils/src/presets/`)
— those presets are constrained to audits Lighthouse ships by default, and both audits here are
opt-in via `configPath`, so they can't be part of that guarantee. Set severity yourself in your own
`.lighthouserc.js`:

```js
module.exports = {
  ci: {
    collect: {settings: {configPath: require.resolve('@lhci/seo-audits/lighthouse-config.js')}},
    assert: {
      assertions: {
        'structured-data-json-ld': ['error', {}], // or 'warn'
        'structured-data-schema-properties': ['error', {}], // or 'warn'
      },
    },
  },
};
```
