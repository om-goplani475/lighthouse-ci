# /intake

Run Agent 00 — Product Intake.

Takes a raw feature request and produces a structured Feature Spec for Gate 0 review.

## Usage

```
/intake "add an audit that flags broken internal links"
```

## What it does

1. Reads `.ai-agents/state/security-findings.md` — refuses to start if an unresolved `critical`
   finding is open.
2. Reads `.ai-agents/agents/00-product-intake.md` for full instructions.
3. Uses Claude Opus with extended thinking to clarify scope with the developer.
4. Outputs structured Feature Spec to `docs/feature-specs/{slug}.md`.
5. Updates `.ai-agents/state/current-feature.md`.

## After it completes

Review `docs/feature-specs/{slug}.md` against `.ai-agents/gates/gate-0-checklist.md`.

When approved, run both of these (can be in parallel):
```
/design-audit
/design-contract
```
