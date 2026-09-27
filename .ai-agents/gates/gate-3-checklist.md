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

If anything fails: fix before merge, don't merge and fix later. After merge, run
`/validate-fixtures`, then `/write-qa` and `/security-review` in parallel.
