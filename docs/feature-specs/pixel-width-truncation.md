# Feature: Title and Meta Description Pixel-Width Truncation

- slug: pixel-width-truncation
- requested: 2026-09-29
- type: new-audit

## Summary

A new audit that flags when a page's `<title>` or meta description would likely be visually
truncated in Google's search results — based on **real rendered pixel width**, not a
character-count approximation. Google truncates SERP snippets by pixel width, not character
count, so two descriptions of the same character length can truncate differently depending on
which characters they contain (a "W"-heavy description takes more pixels than an "i"-heavy one of
the same length). Decided at Gate 0 (three rounds of blocking questions, all resolved toward the
higher-fidelity option over the simpler alternative):

1. Real pixel measurement, not a character-count heuristic.
2. Real in-browser canvas measurement via a new gatherer, not a static font-metrics data table
   computed in Node.
3. Covers **both** `<title>` and meta description in one feature/gatherer, not description-only
   with title as a separate follow-up — same underlying measurement mechanism, no reason to build
   it twice.

**A caveat that must be stated plainly, not buried**: Google does not officially publish the exact
font, font size, or pixel budget it uses to render/truncate SERP snippets, and these have changed
over time and differ by device. Any value this feature uses is necessarily an approximation
sourced from community/industry SEO-tooling convention, not verified Google documentation — a
materially bigger drift-risk than the "Google's published guidelines might go stale" caveat already
carried by the structured-data features, because there's no official source to even go stale
*from*. This must be stated in the audit's own report messaging, not just internal docs, so a
report reader doesn't mistake "likely truncated" for a verified fact.

## Concrete pass/fail example

- **Pass**: a page's `<title>` and meta description both render, in the simulated SERP font, under
  their respective pixel budgets.
- **Fail**: a meta description that's well under a naive character-count limit (e.g. 140 characters)
  but contains enough wide characters (capital letters, "w"/"m") to exceed the real pixel budget —
  this is the entire reason this feature exists instead of a simpler character-count check; a
  character-count-only version of this audit would miss this exact case.
- **Also fail**: a short-looking title that's actually fine by character count but renders past the
  pixel budget for the opposite reason (unusually wide font rendering of certain character
  combinations).
- **Not applicable**: page has no meta description at all — that's `missing-meta-description`
  territory (already closed, covered by Lighthouse core), not this audit's concern; this audit only
  evaluates truncation risk for content that exists. Same reasoning for a missing `<title>` — covered
  by Lighthouse core's own `document-title` audit.

## Gatherer needs

- New gatherer required: **yes** — the first new gatherer this repo has built since
  `structured-data-json-ld`'s (see `packages/seo-audits/src/gatherers/structured-data-json-ld.js`
  for the established pattern this should follow: `driver.executionContext.evaluate(fn, {args,
  useIsolation, deps})`, which runs a function inside the real page's browser context via CDP —
  confirmed this has full DOM/Canvas API access, not guessed).
- What it needs to collect: the page's `document.title` and meta description content, plus each
  one's rendered pixel width — measured via an off-screen `<canvas>` element's 2D context
  (`ctx.measureText(text).width`), using a font/size intended to approximate Google's SERP
  rendering. The exact font/size values, and whether they should be versioned ruleset data
  (following this repo's established rule-engine pattern) or literal constants, is a design
  decision for Agent 01 — see Open questions below.

## Scope

- Package(s) affected: `packages/seo-audits`
- New audit + new gatherer, following the existing extension-point conventions
  (`.ai-agents/prompts/lighthouse-conventions.md`) — no `packages/utils`/`packages/cli` changes
  expected.
- Out of scope (explicitly):
  - Meta description identical/near-identical to page title — tracked separately as its own
    smaller feature (`docs/phases/phase-1-page-metadata.md` item 1b), no new gatherer needed for
    that one, deliberately not bundled here.
  - Missing/empty meta description or missing/empty title — already covered
    (`missing-meta-description` for description; Lighthouse core's own `document-title` for title).
  - Duplicate titles/descriptions across a site — structurally not buildable by a single-page
    Lighthouse audit; see `docs/phases/phase-1-page-metadata.md`'s "Not possible without new
    infrastructure" section.
  - Any attempt to match Google's *exact* current rendering pixel-for-pixel — explicitly
    impossible to verify without access Google doesn't provide; this audit reports a
    best-available approximation, framed as such in its own messaging, not a guarantee.

## Open questions (for Agent 01 — per `.ai-agents/prompts/blocking-questions.md`, ask the developer
directly if any of these turns out to have more than one reasonable answer with real build
consequences, don't just pick one and document it)

- **Reference font/size for title vs description, and for desktop vs mobile**: needs concrete
  values before implementation. Lighthouse's `passContext.settings.formFactor` tells the gatherer
  which emulation mode the current run is using — should the audit apply a different pixel budget
  for mobile vs desktop (real SERP rendering does differ), or a single conservative budget
  regardless of form factor? This is exactly the kind of design decision that should become
  versioned ruleset data (a new namespace, e.g. `rules/serp-pixel-budgets/{version}.json`) rather
  than a hardcoded constant, consistent with every prior structured-data feature's approach to
  Google-guideline-adjacent values — but confirm this is still the right call here given there's no
  official source to version *against* in the first place (worth a beat of genuine reconsideration,
  not just pattern-matching to the previous features).
- **`useIsolation` and canvas access**: confirm a hidden/off-screen canvas element measurement
  actually works reliably within Lighthouse's isolated execution context the same way DOM queries
  do in the existing gatherer — this needs verifying against a real page during design/implementation,
  not assumed just because DOM access works.
- **Scoring**: binary pass/fail per field (title, description), or a single combined score? If either
  exceeds budget, does the audit fail outright (`error`-equivalent, consumer can gate CI on it), or
  is this closer to `structured-data-rich-result-eligibility`'s informational model, given how
  approximate the underlying measurement inherently is? Worth explicit reasoning, not defaulting to
  "scored because it's a new audit" — the approximation caveat above is a real argument for
  informational-only that shouldn't be waved past.
