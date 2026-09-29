# Audit spec: Title and Meta Description Pixel-Width Truncation

- slug: pixel-width-truncation
- upstream-sync checked against: lighthouse@12.6.1 (unchanged since every prior feature this
  session — confirmed via `node_modules/lighthouse/package.json`, no `node_modules`/lockfile
  commits since).

**The core technical risk was verified live before finalizing this design, not assumed**: built a
disposable gatherer/audit/config inside `packages/seo-audits/src/` (never committed), ran it via a
real `lhci collect` against a static test page, and confirmed
`driver.executionContext.evaluate(fn, {useIsolation: true})` can create an off-screen `<canvas>`,
set a font, and call `ctx.measureText(text).width` — returned a genuine non-trivial float
(387.177734375px for a 45-character test title at `20px Arial`), proving the mechanism works
inside Lighthouse's real execution context, not just in theory. Cleaned up immediately after
(no trace left in git history or the working tree).

## Gatherer

- New gatherer: `PixelWidth` (working name — Agent 04 may rename during implementation if a
  clearer name emerges, not load-bearing).
- Data collected: `document.title` text, meta description text (if present), and each one's
  rendered pixel width, measured via an off-screen canvas inside the page's own browser context.
- Collection method: `driver.executionContext.evaluate(fn, {args, useIsolation: true, deps: []})`
  — same mechanism as `structured-data-json-ld`'s gatherer, verified live for canvas specifically
  (see above). The evaluated function does everything in one round-trip: read `document.title`,
  read `document.querySelector('meta[name="description"]')?.content`, measure both via canvas,
  return `{title: {text, widthPx} | null, description: {text, widthPx} | null}` (`null` when the
  element/content is absent — this audit doesn't duplicate `document-title`'s or
  `missing-meta-description`'s presence checks, per the feature spec's explicit scope boundary).

### A real architectural first, flagged explicitly: the gatherer depends on the rule engine

Every gatherer in this package so far has been a pure, rule-agnostic data collector — audits are
what apply this fork's own rule content. This feature breaks that separation, unavoidably: the
**font** used for measurement is itself an assumption about Google's SERP rendering (there's no
way to measure "pixel width" without picking *some* font first), and this repo's established
convention treats Google-guideline-adjacent values as versioned ruleset data, not hardcoded
constants (`structured-data-schema-properties`, `structured-data-rich-result-eligibility`,
`structured-data-type-conflicts` all follow this). So: **the gatherer itself imports
`resolveSerpPixelBudgetsRuleset()` from `../rule-engine/registry.js` at module scope** (identical
pattern to how every audit already resolves its own ruleset), reads `ruleset.title.font` and
`ruleset.description.font`, and passes those font strings as `args` into the evaluated page
function. This is a deliberate, reasoned exception to "gatherers are rule-agnostic," not an
oversight — Agent 02's contract and Agent 04's implementation should both treat this as the
documented precedent for any *future* gatherer that similarly needs a rule-derived parameter, not
copy it reflexively for gatherers that don't need one.

The **pixel budget** (max width before truncation) is a separate concern the gatherer does *not*
need — only the audit needs it, to compare the gatherer's measured width against a threshold. So
the gatherer resolves only `.title.font`/`.description.font`; the audit separately resolves the
same ruleset for `.title.maxWidthPx[formFactor]`/`.description.maxWidthPx[formFactor]`. Font size
is treated as device-independent (real citations for Google's SERP rendering suggest a fairly
consistent font/size across devices); only the *available width* (and therefore the budget) is
device-dependent, read from `passContext.settings.formFactor` — confirmed a real, accessible field
(`Gatherer.Context.settings: Config.Settings`, `node_modules/lighthouse/types/gatherer.d.ts`), not
guessed.

## New rule-engine namespace: `serp-pixel-budgets`

Following the same versioned-data pattern as every prior structured-data feature:
- `rules/serp-pixel-budgets/{version}.json` + `current.json`, resolved via a new
  `resolveSerpPixelBudgetsRuleset()` in `registry.js` (same additive-only pattern the
  `type-conflicts` namespace already established — copy that precedent, don't modify any existing
  `resolve*Ruleset` function).
- New JSON Schema: `rules/schema/serp-pixel-budgets-ruleset.schema.json`.
- New typedef in `rule-engine/types.js`: `SerpPixelBudgetsRuleSet`.

### Ruleset content (v1) — read the caveat below before trusting these numbers

```json
{
  "version": "2026-10",
  "title": {
    "font": "400 20px Arial, sans-serif",
    "maxWidthPx": {"desktop": 600, "mobile": 580}
  },
  "description": {
    "font": "400 14px Arial, sans-serif",
    "maxWidthPx": {"desktop": 920, "mobile": 680}
  }
}
```

**These specific numbers are a widely-cited industry-SEO-tooling approximation, not verified
against a live Google SERP during this design session** — I do not have live web access, and even
with it, Google doesn't publish these values officially, so "verified" isn't fully achievable
regardless. This is a materially different, *worse* confidence level than the structured-data
features' guideline caveats (those at least approximate a *published* Google document that could
in principle be checked against; this approximates an *unpublished, reverse-engineered* rendering
detail that could simply be wrong, stale, or was never right to begin with). This must be stated
in the audit's own `description` string and report messaging — "may be truncated based on an
approximate rendering model," never "will be truncated" or unqualified "is too long."

## Audit

- Audit id: `pixel-width-truncation`.
- **Scoring: informational only, `scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE`** — resolved
  the feature spec's open question explicitly, not by default. Given the ruleset caveat above (an
  unverifiable, reverse-engineered approximation, not a rule this fork can stand behind with the
  same confidence as its structured-data guideline data), gating CI on it would fail builds based
  on a guess this repo cannot verify accuracy for. Same mechanism as
  `structured-data-rich-result-eligibility` — `score` is always `null` internally, normalizes to
  `1` in the LHR (confirmed behavior from that feature's QA), so a `minScore` assertion on this
  audit will always pass; the README must say so plainly, learning directly from that feature's
  own design-time mistake (an earlier draft of *that* feature's docs wrongly claimed the opposite
  before live verification corrected it).
- `audit()` logic: for each of `title`/`description` present in the gatherer artifact, compare
  `widthPx` against `ruleset.{field}.maxWidthPx[formFactor]`, reading `context.settings.formFactor`
  — confirmed real via `static audit(artifacts, context)` (`node_modules/lighthouse/core/audits/audit.js:93`)
  and `context.settings.formFactor` (an established pattern already used by multiple core audits,
  e.g. `largest-contentful-paint-element.js:165`), not guessed. If over budget, add a row. If under
  budget or the field is absent (nothing to measure), no row for that field.
- `{score: null, notApplicable: true}` only when **both** title and description are absent from
  the gatherer artifact (nothing to evaluate at all) — matches this package's established
  not-applicable convention.
- `DetailsType`: `table`. Columns: `field` (text — "title"/"description"), `widthPx` (numeric,
  rounded to a sensible precision for display), `maxWidthPx` (numeric), `text` (text — the actual
  measured content, so a report reader can see what's being flagged).
- Stamp `details.rulesetVersions = {serpPixelBudgets: ruleset.version}`.

## Category placement

- Category: `seo-extended` (existing), weight 1 — same category every audit in this package uses.

## Extension point

Unchanged: `packages/seo-audits/src/lighthouse-config.js`'s `configPath`-based registration — add
the new gatherer to `artifacts` and the new audit to `audits`/`categories['seo-extended'].auditRefs`.

## Risks / open questions

- **Ruleset accuracy is fundamentally unverifiable** (see caveat above) — this is the central,
  accepted risk of this entire feature, not a corner case. Recommend the README carry the same
  hedge language as the ruleset/audit description, consistently, in all three places.
- **Canvas font availability in headless Chrome**: `Arial` was used in the live verification test
  and rendered a real (non-zero, non-fallback-suspicious) width, but headless Chrome's font
  availability can vary by OS/environment — Agent 04 should sanity-check the measured width isn't
  suspiciously equal to a generic fallback-font width across very different test strings (a cheap
  regression check: two strings of very different character composition should produce
  meaningfully different widths, not near-identical ones, which would suggest the font didn't
  actually apply).
- **Task sequencing**: this is a new gatherer + new rule-engine namespace + new audit — closer in
  shape to `structured-data-rule-engine`'s original task count than to
  `structured-data-rich-result-eligibility`'s single-audit scope. Agent 03 should sequence
  accordingly.
