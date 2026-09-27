# Lighthouse CI (fork) — development guide

This is a fork of Google's [lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci), a Yarn/Lerna
monorepo. `upstream` is kept as a remote purely to pull Google's future changes — nothing here is
intended to be upstreamed back.

## Packages

- `packages/cli` — the `lhci` CLI: `collect`, `assert`, `upload`, `autorun`, `server`, `wizard`.
- `packages/server` — the LHCI server: stores reports, runs comparisons, exposes the API the CLI/viewer use.
- `packages/utils` — shared logic: assertions, `.lighthouserc.js` parsing, budgets, presets, the LHR
  report utilities most other packages depend on.
- `packages/viewer` — the report-viewing UI.
- `packages/seo-audits` — **this fork's addition.** New audits/gatherers (SEO and beyond) live here as
  a package that *depends on* `@lhci/utils`/`@lhci/cli`, not by editing their source. Keeping new work
  in its own package is what keeps `yarn install && git pull upstream main` a clean merge.

## Commands

```bash
yarn install            # install workspace deps
npm run test            # typecheck + lint + unit — run before every commit
npm run test:typecheck  # tsc -p .
npm run test:lint       # eslint across packages/*/src and packages/*/test
npm run test:unit       # jest --maxWorkers=2
npm run build           # builds @lhci/server + @lhci/viewer
```

Run `npm run test:quick` while iterating (skips the slow `cli.test.js` suite); run the full `npm run test`
before committing.

## The `.ai-agents/` pipeline

New features in `packages/seo-audits` are built through a 10-stage agent pipeline, not ad-hoc
prompting. Start with `AGENTS.md` for the full map. In short:

1. Every stage's output is a **file** (`docs/...` or `.ai-agents/state/...`), not conversation memory —
   read the actual files, don't assume context carries over between stages.
2. Stages run through slash commands (`/intake`, `/design-audit`, `/design-contract`, `/sequence-tasks`,
   `/implement`, `/validate-fixtures`, `/write-qa`, `/security-review`, `/ci-integration`,
   `/write-changelog`) — see `.claude/commands/`.
3. Manual gates (`.ai-agents/gates/gate-{0..3}-checklist.md`) sit between stages — don't auto-advance
   past one.
4. Before designing a new audit or gatherer, check it against current upstream Lighthouse APIs — see
   `.ai-agents/prompts/upstream-sync.md`. Upstream can change the LHR schema or extension points out
   from under a stale design.

## Rules for this fork specifically

- New audit/gatherer code goes in `packages/seo-audits`. Don't edit `packages/utils` or `packages/cli`
  source directly except through an agreed extension point (documented in
  `.ai-agents/prompts/lighthouse-conventions.md`) — direct edits there are exactly what turns a future
  `git pull upstream main` into a conflict-resolution exercise.
- One task = one commit, per the task sequence produced by `/sequence-tasks`. Don't batch unrelated
  changes into a single commit even when implementing sequentially.
- Every new audit needs a static mock-HTML fixture test (see `.ai-agents/prompts/testing-patterns.md`)
  — this repo does not hit live URLs in tests.
