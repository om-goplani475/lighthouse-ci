# /security-review

Run Agent 07 — Security Reviewer.

Audits the merged feature for SSRF, crawler abuse, and Chromium/Puppeteer sandbox risks.

## Usage

```
/security-review
```

Run promptly after Gate 3 merge (not deferred), in parallel with `/write-qa`.

## What it does

1. Reads `.ai-agents/agents/07-security-reviewer.md` and `.ai-agents/prompts/security-checklist.md`.
2. Uses Claude Opus with extended thinking.
3. Fetches merged diff via `git diff {base_commit}..{merged_head}`, read from
   `.ai-agents/state/current-feature.md` (falls back to `main~1..main` only if unset).
4. Posts findings as a comment on the closed PR.
5. Appends to `.ai-agents/state/security-findings.md`.

## Blocking behaviour

If any `critical` finding is reported, the next `/intake` refuses to start until it's resolved
(enforced in `.ai-agents/agents/00-product-intake.md`, Step 1).
