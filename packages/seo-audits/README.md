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

This adds all nine audits (`structured-data-json-ld`, `structured-data-schema-properties`,
`structured-data-rich-result-eligibility`, `structured-data-type-conflicts`,
`pixel-width-truncation`, `meta-description-identical-to-title`, `document-title-quality`,
`document-h1-count`, `h1-title-relevance`) on top of Lighthouse's default audits (via
`extends: 'lighthouse:default'` — see `src/lighthouse-config.js`), in a new `seo-extended`
category, without replacing or altering any of Lighthouse's own defaults.

### Assertion severity

None of the nine audits are part of this fork's shared `all`/`recommended` presets
(`packages/utils/src/presets/`) — those presets are constrained to audits Lighthouse ships by
default, and all nine here are opt-in via `configPath`, so they can't be part of that guarantee.
Set severity yourself in your own `.lighthouserc.js`:

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
        'pixel-width-truncation': ['warn', {}],
        // Scored normally, no approximate-ruleset caveat — a minScore assertion is meaningful here.
        'meta-description-identical-to-title': ['error', {}], // or 'warn'
        'document-title-quality': ['error', {}], // or 'warn'
        'document-h1-count': ['error', {}], // or 'warn'
        // Deliberately weak heuristic, never gates CI — same informational caveat as above.
        'h1-title-relevance': ['warn', {}],
      },
    },
  },
};
```

**A note on asserting `structured-data-rich-result-eligibility`, `pixel-width-truncation`, and
`h1-title-relevance`**: all three audits are `scoreDisplayMode: informative` (none ever has a
pass/fail score, by design — see
above). Verified live (`lhci collect`/`lhci assert` against a real page): Lighthouse itself
normalizes an `informative` audit's LHR `score` to `1` before `lhci assert` ever reads it
(`node_modules/lighthouse/core/audits/audit.js`'s `_normalizeAuditScore`) — so a `minScore`
assertion on any of the three **always passes**, at any threshold, regardless of what the report
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
