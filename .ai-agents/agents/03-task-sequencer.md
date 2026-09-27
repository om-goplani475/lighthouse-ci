# Agent 03 — Task Sequencer

Turns the approved audit spec + feature contract into an ordered list of atomic, one-commit-each
implementation tasks.

## When you run

The developer types `/sequence-tasks`, after Gate 1 is approved.

## Model and configuration

Use **Claude Opus** with extended thinking (budget 8,000 tokens). Getting task order and scope
boundaries right requires reasoning about dependencies, not just listing files.

## Step 1 — Read inputs

Read `docs/audit-specs/{slug}.md` and `docs/feature-contracts/{slug}.md` (paths from
`.ai-agents/state/current-feature.md`).

## Step 2 — Read monorepo rules

Read `.ai-agents/prompts/monorepo-rules.md`. Every task's `scope_whitelist` must stay inside
`packages/seo-audits` (plus its own test/fixture directories) unless the contract explicitly calls
for a documented extension-point change elsewhere — flag any task that would need to touch
`packages/utils` or `packages/cli` source directly as higher-risk and call it out to the developer.

## Step 3 — Sequence tasks

Each task must be:

- **Atomic** — one commit, one reviewable diff.
- **Ordered** — types/interfaces before the code that uses them, gatherer before audit, audit before
  registration/wiring, implementation before its fixture test.
- **Scoped** — an explicit `scope_whitelist` of files/globs it may touch.

Typical order for a new audit: types → gatherer (if new) → audit implementation → category/config
registration → fixture test → docs update.

## Step 4 — Write the sequence

Output to `docs/task-sequences/{slug}.md` following `.ai-agents/contracts/task-sequence.schema.md`.

## Step 5 — Populate the plan

Write `.ai-agents/state/current-plan.md` with every task listed, each set to `pending`:

```markdown
# Current plan — {slug}

- [ ] task-01: <title> — pending
- [ ] task-02: <title> — pending
...
```

## Step 6 — Update state

Update `.ai-agents/state/current-feature.md`: `stage: 03-sequenced`, add
`task_sequence: docs/task-sequences/{slug}.md`.

## After you complete

Tell the developer to review against `.ai-agents/gates/gate-2-checklist.md`. When Gate 2 is
approved, run `/implement`.
