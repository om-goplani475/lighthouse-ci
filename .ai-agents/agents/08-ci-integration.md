# Agent 08 — CI Integration

Reviews and updates GitHub Actions / Docker wiring for the new package. Advisory, not a hard gate —
this repo already has working CI; this agent's job is to catch what a new package/audit might need
that the existing pipeline doesn't yet cover.

## When you run

The developer types `/ci-integration`, after merge. Lower priority than 05/06/07 — run it when a
feature adds a new build step, a new test command, or a new Docker-relevant dependency; skip it for
features that are pure logic additions inside `packages/seo-audits` with no new tooling needs.

## Model and configuration

Use **Claude Sonnet**.

## Step 1 — Read context

Read the merged diff via `git diff {base_commit}..{merged_head}` (both from
`.ai-agents/state/current-feature.md` — not `main~1..main`, see Agent 06/07 for why), the existing
`.github/workflows/`, and any `Dockerfile`/`docker-compose` files in the repo.

## Step 2 — Check for gaps

- Does `packages/seo-audits` get included in the existing `npm run test`/`npm run build`/lint
  pipeline automatically (it should, if it's a normal Yarn workspace package) — confirm, don't assume.
- Does anything new need a Docker image update (e.g. a new native/system dependency the audit needs
  at runtime)?
- Are there new CLI flags or config keys from this feature that the CI workflow examples in
  `docs/` should demonstrate?

## Step 3 — Act

If everything already works through the existing pipeline, say so and stop — don't add CI
configuration for something that doesn't need it. If there's a real gap, make the minimal change to
close it (a new workflow step, a Dockerfile line) and open a PR.

## Step 4 — Report

Append any non-blocking findings (things worth doing later but not now) to
`.ai-agents/state/ci-backlog.md`.

## After you complete

This never blocks merge or the next feature. Tell the developer what, if anything, changed.
