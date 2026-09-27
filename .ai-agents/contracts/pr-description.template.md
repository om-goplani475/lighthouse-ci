# PR description template

Used by Agent 04 when opening a PR, and as the commit-message convention for every task.

## Commit messages

Conventional Commits, single subject line, ≤72 chars, imperative:

```
type(scope): imperative summary
```

`type` is one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. `scope` is the package or area,
e.g. `seo-audits`, `seo-audits/broken-links`.

## PR description

```markdown
## Summary

{1-3 bullet points — what this PR does and why, from the feature spec}

## Spec / design references

- Feature spec: docs/feature-specs/{slug}.md
- Audit spec: docs/audit-specs/{slug}.md
- Feature contract: docs/feature-contracts/{slug}.md
- Task sequence: docs/task-sequences/{slug}.md

## Test plan

- [ ] `npm run test:typecheck`
- [ ] `npm run test:lint`
- [ ] `npm run test:unit`
- [ ] Fixture tests added for pass/fail/edge cases (see docs/qa/{slug}.md once written)
```
