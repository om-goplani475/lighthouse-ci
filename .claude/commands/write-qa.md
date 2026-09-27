# /write-qa

Run Agent 06 — QA Spec Writer.

Generates a manual QA checklist covering pass/fail cases, edge cases, and regressions.

## Usage

```
/write-qa
```

Run promptly after Gate 3 merge (not deferred — "merged ≠ done", see `AGENTS.md`), in parallel with
`/security-review`.

## What it does

1. Reads `.ai-agents/agents/06-qa-spec-writer.md`.
2. Reads `docs/feature-specs/{slug}.md` and `docs/feature-contracts/{slug}.md`.
3. Fetches merged diff via `git diff {base_commit}..{merged_head}`, read from
   `.ai-agents/state/current-feature.md` (falls back to `main~1..main` only if unset).
4. Writes QA checklist to `docs/qa/{slug}.md`, verified against a real `lhci collect`/`lhci assert`
   run where practical — not just unit tests.
5. Opens an auto-merge PR (docs only, merges when CI is green).
