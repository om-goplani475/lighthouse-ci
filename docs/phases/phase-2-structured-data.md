# Phase 2 — Structured Data

Live tracker for this phase's work in `packages/seo-audits`. Indexed from `docs/master-roadmap.md`
(local reference only, not tracked in git) and, going forward, from `.ai-agents/state/current-phase.md`
when a phase branch is active for this phase. See `AGENTS.md`'s "Phase branches" section for the
git workflow this file supports.

**Branching note**: phase 2's foundational work (all five features below) was built and merged
directly to `main`, before the phase-branch convention existed — there is no `phase-2-structured-data`
git branch, and the decision (2026-09-29) was not to retroactively create one. Any *new* phase-2 work
picked up after this point should still go through the normal `feat/{slug}` → `main` flow phase 2 has
used throughout, not a phase branch — phase 2 is staying on the pre-phase-branch model for
consistency with its own history, not because the new convention doesn't apply to it.

Status values: **done** (merged + QA'd live, not just unit-tested) · **in progress** · **planned**.
See the three buckets below for everything intentionally not built, and why.

## Features

The original ask was one big "structured data" feature; broken down into six pieces of very
different size/risk during planning on 2026-09-28.

**Architecture pivot (2026-09-28)**: feature #2 was originally speced with rules hardcoded into the
audit. Before building it, we discussed the right architecture and decided to build a small versioned
rule registry/engine foundation first, then populate it with feature #2's content as data instead of
code. Full reasoning: `docs/architecture/structured-data-rule-engine.md`. Feature #2 is **paused**,
superseded by the new foundational feature below — its intake spec still documents the desired
property-validation behavior and stays as reference for the rule-engine feature to consume.

| # | Feature | Status | Slug / spec |
|---|---------|--------|--------------|
| 0 | JSON-LD parsing, JSON validity, `@context`/`@type` presence | **done** | `structured-data-validation` — `docs/feature-specs/structured-data-validation.md` |
| — | **Structured-data rule engine** (versioned registry + engine; also builds the real `structured-data-schema-properties` audit, scoped to `Product`+`Article`, and migrates `structured-data-json-ld` onto it) | **done** | `structured-data-rule-engine` — `docs/feature-specs/structured-data-rule-engine.md`, QA'd live `docs/qa/structured-data-rule-engine.md` |
| 1 | Rich-result eligibility report (per-type inventory: which of the 12 tracked types are on the page, and whether Google currently documents rich-result support for each) | **done** | `structured-data-rich-result-eligibility` — `docs/feature-specs/structured-data-rich-result-eligibility.md`, QA'd live `docs/qa/structured-data-rich-result-eligibility.md`. Built as a genuinely separate, purely-informational audit (`scoreDisplayMode: informative`) rather than closing this as already-covered by the eligibility rows already inside `structured-data-schema-properties` — see that spec's "redundancy question" section for the reasoning Gate 0 weighed. |
| 2 | Required/recommended property validation per schema type — all 12 types | **done** | `structured-data-remaining-types` — `docs/feature-specs/structured-data-remaining-types.md`, QA'd live `docs/qa/structured-data-remaining-types.md`. Shipped as pure ruleset data (`rules/*/2026-10.json`) with zero audit/engine code changes, confirming the rule-engine's core design promise. Original full-scope reference spec: `docs/feature-specs/structured-data-schema-properties.md`. |
| 3 | Duplicate/conflicting `@type` detection | **done** | `structured-data-type-conflicts` — `docs/feature-specs/structured-data-type-conflicts.md`, QA'd live `docs/qa/structured-data-type-conflicts.md`. Two checks, different severity: `duplicate-count` (scored) and `conflicting-entity` (informational, strong-identity-fields-only matching to avoid flagging legitimately different entities of the same type). A real security finding (page-controlled `@type` used as a plain-object key, enabling a `"__proto__"` edge case) was caught in review and fixed same-sitting — see `.ai-agents/state/security-findings.md`. |
| 4 | Invalid property value types (e.g. `price` as a non-numeric string) | **done** | Extended `google-requirements-engine.js` with an additive `datatypes` map (per type/nested rule in `rules/google/structured-data/2026-10.json`) — `number`/`date`/`currency` checks, only for properties already tracked as `required`, only when present (missing stays `required`'s concern). Covers `Product.offers.price`/`priceCurrency`, `Article.datePublished`, `Event.startDate`, `JobPosting.datePosted`, `VideoObject.uploadDate`, `Review.reviewRating.ratingValue`. Built via a lightweight pass (no formal design docs), QA'd live see `docs/qa/structured-data-datatypes.md`. No new namespace — findings reuse `google-requirements` and drive the same score as a missing-property finding. |
| 5 | `@graph` handling, multiple-entity relationship modeling | planned | not yet scoped |
| 6 | Schema.org version awareness, deprecated-property detection | planned | not yet scoped |

## Deferred

Deliberately out of scope, with a real reason. May get built later if the reason changes — these
are choices, not impossibilities.

| Item | Why deferred | Reference |
|---|---|---|
| Cross-check structured data claims against visible page content (spam/policy risk detection) | Fundamentally different kind of check (DOM-content comparison, not markup validation) with real false-positive risk; needs its own careful spec, not bundled with the structured-data property/eligibility work | this file |
| Microdata/RDFa support (beyond JSON-LD) | Separate markup format from JSON-LD, needs its own gatherer from scratch. JSON-LD is what Google actually recommends and what's dominant in practice — revisit only if a specific real site actually needs it | this file |

## To do later

Scoped, understood, genuinely intended to happen — just sequenced after something else, or waiting
on real-world usage data this pipeline doesn't have yet.

| Item | What unblocks it / when it's intended | Reference |
|---|---|---|
| Automated Google-doc change detection (notice when Google's published structured-data guidelines change) | Intended to build once the rule engine has run in practice for a while — needs real usage first to know what "detected a change" should actually trigger (a PR draft? a backlog item? nothing automatic?) rather than guessing that workflow up front | `docs/architecture/structured-data-rule-engine.md` |
| LLM-assisted rule extraction (turn a detected Google doc change into a ruleset JSON diff automatically) | Same timing as automated detection above — deliberately sequenced after it, not built in parallel, since extraction without reliable change-detection first would have nothing trustworthy to extract from | `docs/architecture/structured-data-rule-engine.md` |
| Remaining 10 types' `Recipe`/`Event`/`JobPosting` property lists — lower-confidence entries not folded into `required` (e.g. `Recipe.aggregateRating`/`nutrition`, `Event.offers`, `JobPosting.validThrough`) | Deliberately left out of v1 to avoid over-claiming confidence in Google's exact required/recommended boundary for these three types, which hedges more than `Product`/`Article`/the others did. Candidate additions for the next ruleset version once there's real signal on whether they matter | `docs/audit-specs/structured-data-remaining-types.md` |
| Eligibility ruleset's boolean `supported` model — can't express "restricted to a narrow site category," only true/false | `FAQPage`/`HowTo` are currently approximated as `supported: false` because Google actually restricts both to a narrow authoritative-site category and the schema has no middle state. Extending to a three-state schema (`supported: 'restricted'` + a note field) was raised as an option and explicitly deferred rather than folded into either shipped feature, to keep each one data-only/scope-contained | `docs/audit-specs/structured-data-remaining-types.md` |

## Not possible / permanently out of scope

Not a prioritization choice — a real technical or policy constraint that would need to change
before this could happen at all.

| Item | Why | Reference |
|---|---|---|
| Exact parity with Google's Rich Results Test | It's a closed validator, not a published spec — true parity isn't realistically achievable from outside Google, period, not just "not prioritized." Using Google's own *published* per-type guidelines (what `structured-data-schema-properties` already does) captures most of the practical value without chasing an unreachable target | this file |
| Autonomous rule publishing (rule-engine ruleset changes auto-merged without human review) | A real, standing policy "no," not a technical limitation — publishing ruleset changes that affect scoring without a human in the loop is a risk this project isn't willing to take on, independent of how mature the automated-detection/extraction tooling gets. Would need a deliberate decision to reverse | `docs/architecture/structured-data-rule-engine.md` |

## Closed, no build needed

| Feature | Reason | Spec |
|---|---|---|
| Missing/empty meta description audit | Already fully covered by Lighthouse core's `meta-description` audit, already enforced in this fork's `all`/`recommended` presets — nothing to build | `docs/feature-specs/missing-meta-description.md` |

## Pipeline itself

- `.ai-agents/` scaffold: built 2026-09-27, refined twice — once after the first full run (stale
  diff range, Agent 05 folded into Gate 3, "merged ≠ done" made explicit, Lighthouse type/module
  boundaries codified into `lighthouse-conventions.md`), and again 2026-09-29 to add
  `.ai-agents/prompts/blocking-questions.md` (ask design decisions promptly instead of deferring to
  doc prose) and the phase-branch/per-phase-roadmap convention this file is part of. See `AGENTS.md`.
