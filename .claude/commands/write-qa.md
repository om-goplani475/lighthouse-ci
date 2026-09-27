# /write-qa

Run Agent 06 — QA Spec Writer.

Generates a manual QA checklist covering pass/fail cases, edge cases, and regressions.

## Usage

```
/write-qa
```

Run after Gate 3 merge and `/validate-fixtures`, in parallel with `/security-review`.

## What it does

1. Reads `.ai-agents/agents/06-qa-spec-writer.md`.
2. Reads `docs/feature-specs/{slug}.md` and `docs/feature-contracts/{slug}.md`.
3. Fetches merged diff via `git diff main~1..main`.
4. Writes QA checklist to `docs/qa/{slug}.md`.
5. Opens an auto-merge PR (docs only, merges when CI is green).
