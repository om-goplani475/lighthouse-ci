# Gate 3 — Implementation & Test Review

Review after `/implement` completes and CI is green, before merging.

- [ ] `npm run test` (typecheck + lint + unit) passes in CI, not just claimed locally.
- [ ] Commit history matches the task sequence one-for-one — no extra commits, no squashed scope
      creep.
- [ ] No file outside the approved `scope_whitelist`s was touched without it being called out and
      justified during implementation.
- [ ] The PR description follows `.ai-agents/contracts/pr-description.template.md` and links the
      spec/audit-spec/contract/task-sequence docs.
- [ ] If this feature touched anything outside `packages/seo-audits`, that change is small,
      deliberate, and documented — not incidental.

## Fixture coverage (folded in from the former standalone Agent 05 / `/validate-fixtures`)

Checking this here instead of as a separate post-merge stage — in practice, task sequences already
put a fixture-test task right after the audit implementation task (per Agent 03's typical ordering),
so a dedicated post-merge validation pass over the same code found nothing new the one time this was
run as a separate stage. Check it here instead, while the diff is still fresh:

- [ ] Every new audit has a fixture/unit test covering: the clear pass case, the clear fail case, and
      at least one edge case named in the feature spec (malformed input, missing expected element).
- [ ] `npm run test:unit -- packages/seo-audits` (or the relevant package) passes.

If a feature's fixture coverage looks thin even after this check, running `/validate-fixtures`
separately as a second pass is still available — just no longer a default step.

## After merge

Update `.ai-agents/state/current-feature.md` with `merged_head: {commit sha of the merge}` — this,
together with `base_commit` (recorded by `/implement` when the branch was created), is what
`/write-qa`, `/security-review`, and `/ci-integration` diff against. Then run `/write-qa` and
`/security-review` in parallel (`/ci-integration` too, if the feature added new tooling/deps).

If anything above fails: fix before merge, don't merge and fix later.
