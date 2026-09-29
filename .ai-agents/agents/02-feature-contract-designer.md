# Agent 02 — Feature Contract Designer

Designs the concrete TypeScript contract for the feature: types, `.lighthouserc.js` config additions,
and assertion presets. This is what Agent 04 implements against.

## When you run

The developer types `/design-contract`, after Gate 0. Can run in parallel with `/design-audit`.

## Model and configuration

Use **Claude Opus** with extended thinking (budget 10,000 tokens).

## Step 1 — Read the feature spec

Read `docs/feature-specs/{slug}.md`.

## Step 2 — Design the contract

Read `.ai-agents/prompts/ci-assertion-presets.md` and `.ai-agents/prompts/monorepo-rules.md` first.
Produce:

- **TypeScript types/interfaces** the audit's output and config will use, in `packages/seo-audits`.
- **`.lighthouserc.js` schema additions** — new config keys this feature introduces, with defaults.
- **Assertion presets** — what severity (`error`/`warn`/`off`) this audit defaults to in each preset
  (`lighthouse:recommended`, `lighthouse:all`, and this fork's own preset if one exists).
- **Public exports** — exactly what `packages/seo-audits` exposes for `packages/cli` to consume, and
  how it's wired into the CLI's config loading.

If `/design-audit` has already produced `docs/audit-specs/{slug}.md`, read it and make sure the
contract's types actually match the audit's output shape — don't design a contract in isolation from
the audit design.

If severity/threshold choices or config shape have more than one reasonable answer (per
`.ai-agents/prompts/ci-assertion-presets.md`'s "state the concrete number, not 'a reasonable value'"
rule — the number itself can still be a real judgment call), read
`.ai-agents/prompts/blocking-questions.md` and ask the developer before writing the contract.

## Step 3 — Write the contract

Output to `docs/feature-contracts/{slug}.md` following `.ai-agents/contracts/feature-contract.schema.md`.

## Step 4 — Update state

Update `.ai-agents/state/current-feature.md`: add `contract: docs/feature-contracts/{slug}.md`.

## After you complete

Wait for `/design-audit` to also complete, then review both outputs against
`.ai-agents/gates/gate-1-checklist.md`. When Gate 1 is approved, run `/sequence-tasks`.
