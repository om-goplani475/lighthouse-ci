# Agent 04 — Implementer

Implements every task in the approved task sequence, one commit per task, on a single feature branch.

## When you run

The developer types `/implement`, after Gate 2 is approved.

## Model and configuration

Use **Claude Sonnet**. This is execution against an already-designed contract, not open-ended design
— Sonnet is enough, and it's the stage you'll run most often, so cost matters more here than in 00–03.

## Step 1 — Branch

Read `.ai-agents/state/current-phase.md` first. If it names an active phase branch
(`phase-{n}-{slug}`), that's the base for this feature, not `main` — check out (or create, if
resuming) `feat/{slug}` off the phase branch instead. If it says no phase branch is active (the
default, and how phase 2 stayed until it closed out), branch off `main` as usual. Either way, on
creation (not on resume), record the current base-branch commit as `base_commit` in
`.ai-agents/state/current-feature.md` — this is what lets Agents 06/07/08 diff the exact feature
range later, instead of assuming `main~1..main`, which breaks the moment any other commit lands on
the base branch after this feature merges (e.g. another feature's docs commit, or an unrelated
fix).

Gate 3's merge target follows the same rule: merge `feat/{slug}` into whichever branch it was
created off (the active phase branch, or `main`) — never assume `main` without checking
`current-phase.md`. See `AGENTS.md`'s "Phase branches" section for the full convention, including
when a phase branch itself eventually merges into `main`.

## Step 2 — Read the plan

Read `.ai-agents/state/current-plan.md`. If some tasks are already `complete` (resuming after an
interruption), skip them and start from the first `pending` task.

## Step 3 — Implement each task in order

For each `pending` task:

1. Read its `scope_whitelist` from `docs/task-sequences/{slug}.md`. Touch only files matching it.
   If you find you need to touch a file outside the whitelist to make the task work, stop and tell
   the developer — don't silently expand scope.
2. Write the code.
3. Run the fix loop, up to 3 iterations:
   ```
   npm run test:typecheck
   npm run test:lint:fix
   npm run test:unit -- <affected test paths>
   ```
   If still failing after 3 iterations, stop and report the failure to the developer rather than
   forcing a commit.
4. Commit with the message format from `.ai-agents/contracts/pr-description.template.md`'s commit
   convention (Conventional Commits, one line, e.g. `feat(seo-audits): add broken-link audit types`).
5. Mark the task `complete` in `.ai-agents/state/current-plan.md`.

## Step 4 — Full validation

Once all tasks are complete, run the full `npm run test` and `npm run build` (only if this feature
touches `packages/server` or `packages/viewer` wiring — most `seo-audits`-only features won't need a
full build). Fix any failure before proceeding.

## Step 5 — Open the PR

Push `feat/{slug}` and open a PR using `.ai-agents/contracts/pr-description.template.md`.

## Resume behaviour

If interrupted at any point, re-running `/implement` picks up exactly where `current-plan.md` left
off — no need to re-explain state.

## After you complete

Tell the developer: wait for CI to go green, then review the PR against
`.ai-agents/gates/gate-3-checklist.md`. After merge, run `/validate-fixtures`, then `/write-qa` and
`/security-review` in parallel.
