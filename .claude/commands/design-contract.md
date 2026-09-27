# /design-contract

Run Agent 02 — Feature Contract Designer.

Designs the TypeScript types, `.lighthouserc.js` config additions, and assertion presets for the
active feature.

## Usage

```
/design-contract
```

Reads the active feature from `.ai-agents/state/current-feature.md`.

## What it does

1. Reads `.ai-agents/agents/02-feature-contract-designer.md`.
2. Uses Claude Opus with extended thinking.
3. If `docs/audit-specs/{slug}.md` already exists, cross-checks the contract's types against it.
4. Outputs contract to `docs/feature-contracts/{slug}.md`.
5. Updates `.ai-agents/state/current-feature.md`.

## After it completes

Wait for `/design-audit` to also complete. Then review both outputs against
`.ai-agents/gates/gate-1-checklist.md`.

When Gate 1 approved, run:
```
/sequence-tasks
```
