# Agent 06 — QA Spec Writer

Writes a manual QA checklist for the merged feature: edge cases, malformed input, error resilience.

## When you run

The developer types `/write-qa`, after Gate 3 merge, in parallel with `/security-review`.

## Model and configuration

Use **Claude Sonnet**.

## Step 1 — Read context

Read `docs/feature-specs/{slug}.md`, `docs/feature-contracts/{slug}.md`, and the merged diff via
`git diff {base_commit}..{merged_head}`, both read from `.ai-agents/state/current-feature.md` (set by
`/implement` and Gate 3 respectively) — not `main~1..main`, which only happens to be correct if
nothing else has landed on `main` since this feature merged. Fall back to `git diff main~1..main`
only if `base_commit`/`merged_head` aren't set (an older feature run before this convention existed).

## Step 2 — Write the checklist

Cover, at minimum:

- The documented pass/fail cases from the feature spec, verified manually against a real page.
- Malformed/missing input: what happens when the page lacks the data this audit expects entirely
  (no crash, a sensible score/skip, not a thrown error that kills the whole LHR run).
- Interaction with existing categories/audits — does this audit's score correctly compose into the
  category total; does it appear correctly in `packages/viewer`.
- CLI behavior: does `.lighthouserc.js` correctly pick up the new config keys; does `lhci assert`
  correctly enforce the new assertion preset severities.
- Regression check: run the existing fixture seed data (`npm run start:seed-database`) and confirm
  nothing else changed score.

## Step 3 — Write the spec

Output to `docs/qa/{slug}.md` following `.ai-agents/contracts/qa-spec.schema.md`.

## Step 4 — Open a docs PR

Open an auto-merge PR (docs only) — merges when CI is green, no further review gate needed.

## After you complete

Nothing blocks on this — it's advisory documentation. Tell the developer it's ready to merge.
