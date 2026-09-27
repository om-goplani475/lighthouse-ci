# /sequence-tasks

Run Agent 03 — Task Sequencer.

Produces an ordered, atomic implementation task list where each task becomes one commit.

## Usage

```
/sequence-tasks
```

Reads the active feature from `.ai-agents/state/current-feature.md`.

## What it does

1. Reads `.ai-agents/agents/03-task-sequencer.md`.
2. Uses Claude Opus with extended thinking.
3. Reads `docs/audit-specs/{slug}.md` and `docs/feature-contracts/{slug}.md`.
4. Flags any task whose `scope_whitelist` reaches outside `packages/seo-audits`.
5. Outputs task sequence to `docs/task-sequences/{slug}.md`.
6. Populates `.ai-agents/state/current-plan.md` with all tasks set to `pending`.

## After it completes

Review against `.ai-agents/gates/gate-2-checklist.md`.

When Gate 2 approved, run:
```
/implement
```
