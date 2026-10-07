# Phase 16: Site intelligence (the summary layer)

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-16-site-intelligence` (off `main`). Merges into `main` once every item is done, deferred, to-do-later or marked not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

**Status: Done (2026-10-06), merged into `main`.**

## Decisions (design conversation, 2026-10-06, lightweight mode)

| Question | Decision |
|---|---|
| Form | A **standalone command**, `packages/seo-audits/src/summary/cli.js`, that reads the `lhr-*.json` files `lhci collect` wrote. No change to Lighthouse or `lhci`; it works on any past report folder. |
| Aggregate score | **Tier-weighted per category.** The share of applicable scored audits that pass: an error-tier audit weighs 3, a warn-tier audit 1, a partial score (0.5) counts as half, not-applicable audits are left out; shown as 0 to 100 with a grade (A at 90, F under 60). The tier of an audit is its level in `recommended-assertions.json`; informational audits are never scored. |
| Prioritisation | **Tier, then reach.** Error before warn; within a tier by how many items the audit found (its `numericValue`, else its table rows); then by id. Nothing invented. |
| History and guidance | **Compare two runs** (new / fixed / still failing, worse or better, score deltas) and use **the audit's own text** as the fix guidance. No database, no stored state. |

## Items

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Per-run summary: category scores, overall score and grade, ranked issues | **done** | `src/summary/run-summary.js`, `categories.js` (12 categories, every one of the 99 audits of the time (126 now) mapped once; a test enforces it) |
| 2 | Compare two report folders | **done** | `src/summary/compare.js` (pairs pages by URL, trailing slash ignored) |
| 3 | Markdown and JSON output, fix guidance | **done** | `src/summary/render.js`; table cells escape pipes, angle brackets, square brackets and backticks |
| 4 | The command | **done** | `src/summary/cli.js`, `load.js`: `--compare`, `--format`, `--top`, `--guidance`, `--out`; exits 0 (reporting, not gating), 2 on bad usage |
| 5 | Use it in the A3 workflow summary | **done** | `.github/workflows/seo-audit.yml` |

## Deferred

| Item | Why |
|---|---|
| Stored history over many runs (trends) | needs somewhere to keep it between CI runs; belongs with Phase 17 (scheduled runs) |
| A hand-set impact hint per audit for ranking | would be my judgement, not data; reach is used instead |
| `--fail-under N` (gate on the score) | `lhci assert` already gates; a score gate is a Phase 17 CI decision |

## Not possible, or out of scope

An aggregate shown inside Lighthouse's own HTML report (one audit cannot see the others' results cleanly); a score comparable across different sites (the weights are this fork's, not a standard).
