# /implement

Run Agent 04 — Implementer.

Implements all tasks from the approved task sequence on a single feature branch, one commit per
task.

## Usage

```
/implement
```

Reads the active feature and plan from `.ai-agents/state/current-feature.md` and
`.ai-agents/state/current-plan.md`.

## What it does

1. Reads `.ai-agents/agents/04-implementer.md`.
2. Checks out (or resumes) `feat/{slug}`.
3. Reads `.ai-agents/state/current-plan.md` — resumes from first `pending` task if interrupted.
4. For each task: implements within its `scope_whitelist` only, runs
   `test:typecheck`/`test:lint:fix`/`test:unit` (up to 3 fix iterations), commits, marks the task
   `complete`.
5. Opens a PR using `.ai-agents/contracts/pr-description.template.md`.

## Resume behaviour

If interrupted, re-run `/implement` — it reads `.ai-agents/state/current-plan.md` and skips completed
tasks automatically.

## After it completes

Wait for CI to go green, then review the PR against `.ai-agents/gates/gate-3-checklist.md`.

After merge, run:
```
/validate-fixtures
```
