# /security-review

Run Agent 07 — Security Reviewer.

Audits the merged feature for SSRF, crawler abuse, and Chromium/Puppeteer sandbox risks.

## Usage

```
/security-review
```

Run after Gate 3 merge, in parallel with `/write-qa`.

## What it does

1. Reads `.ai-agents/agents/07-security-reviewer.md` and `.ai-agents/prompts/security-checklist.md`.
2. Uses Claude Opus with extended thinking.
3. Fetches merged diff via `git diff main~1..main`.
4. Posts findings as a comment on the closed PR.
5. Appends to `.ai-agents/state/security-findings.md`.

## Blocking behaviour

If any `critical` finding is reported, the next `/intake` refuses to start until it's resolved
(enforced in `.ai-agents/agents/00-product-intake.md`, Step 1).
