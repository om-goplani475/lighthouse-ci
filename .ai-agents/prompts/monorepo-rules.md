# Monorepo rules

Read by Agents 03, 04. This repo is a Yarn workspaces + Lerna monorepo (`packages/*`).

## Package boundaries

- `packages/cli` — depends on `packages/utils`. Never depends on `packages/seo-audits` directly for
  core commands; `seo-audits` registers into the CLI's config loading as a consumer, not the other
  way around.
- `packages/server` and `packages/viewer` consume the LHR shape produced by audits — they don't know
  or care which package produced a given audit. A change to an audit's `details`/`DetailsType` shape
  can still break rendering in `viewer` even though `viewer` never imports `seo-audits`.
- `packages/seo-audits` — this fork's package. Depends on `@lhci/utils`/`@lhci/cli` as a library
  (workspace dependency), never the reverse.

## Cross-package dependency rule

If a task's `scope_whitelist` needs to touch a file outside `packages/seo-audits`, that's a signal
the feature is reaching into Google's original code rather than using an extension point — flag it
at Gate 2 rather than proceeding quietly. Occasionally justified (e.g. `packages/server` genuinely
needs a new documented extension hook that doesn't exist yet), but it should be rare and explicit,
never a task's fallback plan.

## Build/test commands (run from repo root)

```bash
yarn install
npm run test:typecheck   # tsc -p . — whole repo, not per-package
npm run test:lint        # eslint ./packages/*/src, ./packages/*/test
npm run test:unit        # jest --maxWorkers=2 — whole repo unless scoped with -- <path>
npm run build            # builds @lhci/server + @lhci/viewer only; seo-audits has no separate build step unless one is added
```

`test:typecheck` and `test:lint` run across all packages by default — a change confined to
`packages/seo-audits` can still fail typecheck if it breaks a type another package re-exports.
