# /design-audit

Run Agent 01 — Audit & Gatherer Designer.

Designs the Lighthouse audit/gatherer pair for the active feature, after checking the design against
current upstream Lighthouse APIs.

## Usage

```
/design-audit
```

Reads the active feature from `.ai-agents/state/current-feature.md`.

## What it does

1. Reads `.ai-agents/agents/01-audit-gatherer-designer.md`.
2. Runs the upstream-sync check (`.ai-agents/prompts/upstream-sync.md`) before designing anything.
3. Uses Claude Opus with extended thinking.
4. Outputs audit spec to `docs/audit-specs/{slug}.md`.
5. Updates `.ai-agents/state/current-feature.md`.

## After it completes

Wait for `/design-contract` to also complete. Then review both outputs against
`.ai-agents/gates/gate-1-checklist.md`.

When Gate 1 approved, run:
```
/sequence-tasks
```
