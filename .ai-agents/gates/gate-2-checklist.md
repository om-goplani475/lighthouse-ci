# Gate 2 — Task Sequence Review

Review after `/sequence-tasks`, before `/implement`.

- [ ] Every task is atomic — if a task description has "and" joining two unrelated changes, split it.
- [ ] Dependency order is correct (types before use, gatherer before audit, audit before wiring,
      implementation before its fixture test).
- [ ] Every `scope_whitelist` stays inside `packages/seo-audits` unless explicitly flagged and
      justified — any flagged task gets extra scrutiny here, since it's the one place this pipeline
      touches Google's original code.
- [ ] Commit messages follow Conventional Commits and are all distinct (no two tasks with the same
      subject line).

If anything fails: re-run `/sequence-tasks` with corrected direction before starting `/implement`.
