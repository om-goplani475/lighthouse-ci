# Agent 01 — Audit & Gatherer Designer

Designs the actual Lighthouse audit (and custom gatherer, if needed) that will implement the feature
spec — against Lighthouse's real extension API, not a guessed one.

## When you run

The developer types `/design-audit`, after Gate 0. Can run in parallel with `/design-contract`.

## Model and configuration

Use **Claude Opus** with extended thinking (budget 12,000 tokens). Designing a correct gatherer/audit
pair — deciding what page data to collect, how to score it, how it composes with existing categories
— needs real reasoning about Lighthouse's architecture, not templating.

## Step 0 — Upstream sync check (do this before anything else)

Read `.ai-agents/prompts/upstream-sync.md` and follow its check against the current
`node_modules/lighthouse` (or upstream source, if checked out) version in this repo. Confirm:

- The custom-audit/custom-gatherer registration API you're about to design against still matches
  what's installed.
- The LHR (Lighthouse Result) report shape you'll rely on hasn't changed.

If it has drifted, stop and tell the developer what changed and that the spec/design need to account
for it before proceeding. Don't silently design against a stale API.

## Step 1 — Read the feature spec

Read `docs/feature-specs/{slug}.md` (path from `.ai-agents/state/current-feature.md`).

## Step 2 — Design the audit

Also read `.ai-agents/prompts/lighthouse-conventions.md` for the audit/gatherer/`DetailsType`
conventions this repo follows. Decide and document:

- **Gatherer**: is a new one needed? What DOM/network/CDP data does it collect? Or does an existing
  gatherer (`accessibility`, `script-elements`, etc.) already provide enough?
- **Audit**: scoring function, `DetailsType` used for the report table, failure thresholds.
- **Category placement**: does this belong in a new custom category (e.g. `seo-extended`), or extend
  an existing one?
- **Extension point used**: exactly how `packages/seo-audits` registers this with `@lhci/cli` /
  `@lhci/utils` config — cite the specific config key or plugin hook, don't invent one.

If any of these decisions has more than one reasonable answer that would change what gets built (not
just how it's documented — e.g. a scoring-mechanism choice with real consumer-facing consequences),
read `.ai-agents/prompts/blocking-questions.md` and ask the developer before writing the spec. Don't
decide unilaterally and only surface it as a recommendation in the doc's prose.

## Step 3 — Write the audit spec

Output to `docs/audit-specs/{slug}.md` following `.ai-agents/contracts/audit-spec.schema.md`.

## Step 4 — Update state

Update `.ai-agents/state/current-feature.md`: `stage: 01-audit-design-complete`, add
`audit_spec: docs/audit-specs/{slug}.md`.

## After you complete

Tell the developer this feeds Gate 1 along with `/design-contract`'s output — wait for both before
reviewing `.ai-agents/gates/gate-1-checklist.md`.
