# /ci-integration

Run Agent 08 — CI Integration.

Checks whether the merged feature needs any GitHub Actions / Docker updates beyond what the existing
pipeline already covers.

## Usage

```
/ci-integration
```

Advisory only — run it when a feature adds a new build step, test command, or runtime dependency;
skip it for pure logic additions inside `packages/seo-audits`.

## What it does

1. Reads `.ai-agents/agents/08-ci-integration.md`.
2. Checks the merged diff (`git diff {base_commit}..{merged_head}` from
   `.ai-agents/state/current-feature.md`, falling back to `main~1..main` only if unset) against
   `.github/workflows/` and any Docker config.
3. Makes the minimal change to close a real gap, if one exists — otherwise reports "no gap found."
4. Appends non-blocking items to `.ai-agents/state/ci-backlog.md`.
