# Current plan — structured-data-type-conflicts

- [x] task-01: type-conflicts typedefs (additive) — complete
- [x] task-02: type-conflicts ruleset JSON Schema — complete
- [x] task-03: Registry — add resolveTypeConflictsRuleset() (touches shared file) — complete (full seo-audits suite re-run, 50/50 green, confirms zero regression in the three existing audits)
- [x] task-04: type-conflicts-engine.js — findDuplicates and findConflicts — complete
- [x] task-05: Ruleset data — type-conflicts namespace — complete
- [x] task-06: Engine and registry unit tests — complete (correction: the "every ruleset file validates" test's directory list was hardcoded, not auto-discovering namespaces — had to add a 4th case for type-conflicts, task description's assumption that it needed no change was wrong)
- [x] task-07: New audit — structured-data-type-conflicts — complete
- [x] task-08: Fixture tests for the new audit — complete
- [x] task-09: Wire into custom Lighthouse config + regression test — complete
- [x] task-10: Package README update — complete

All tasks done. Feature ready for Gate 3 review.
