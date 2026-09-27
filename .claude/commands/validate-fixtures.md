# /validate-fixtures

Run Agent 05 — Fixture Validator. **Optional second pass, not a default step** — fixture coverage is
checked by default at Gate 3 now (see `.ai-agents/gates/gate-3-checklist.md`). Run this only if that
check found a real gap, or fixture tests were skipped during `/implement` for some reason.

Builds/validates the static mock-HTML fixtures the new audit is tested against.

## Usage

```
/validate-fixtures
```

Skip for pure config/docs-only changes that don't add or change audit logic, and skip by default
otherwise — this is not part of the normal per-feature flow anymore.

## What it does

1. Reads `.ai-agents/agents/05-fixture-validator.md` and `.ai-agents/prompts/testing-patterns.md`.
2. Checks fixture coverage for pass/fail/edge cases against the implemented audit.
3. Writes any missing fixtures/tests under `packages/seo-audits/test/`.
4. Runs `npm run test:unit -- packages/seo-audits` and confirms all pass.

## After it completes

Run `/write-qa` and `/security-review` (can be in parallel).
