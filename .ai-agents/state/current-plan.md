# Current plan — structured-data-remaining-types

- [x] task-01: 2026-10 ruleset skeleton — carry forward Product/Article — complete
- [x] task-02: Add BreadcrumbList, Organization, LocalBusiness — complete
- [x] task-03: Add Recipe, Review — complete
- [x] task-04: Add Event, JobPosting — complete
- [x] task-05: Add VideoObject, HowTo — complete (HowTo eligibility set to supported:false, not the true stated in the task sequence's own description — the audit spec's per-type table, the actual authoritative source, already had HowTo grouped with FAQPage's restricted-eligibility note; task-sequence task-05 text was inconsistent with its own source doc, followed the audit spec)
- [x] task-06: Add FAQPage (isolated — shallow-nesting gap + restricted eligibility) — complete
- [x] task-07: Bump current.json to 2026-10 — complete (expected failures now in registry.test.js and structured-data-schema-properties.test.js, fixed by task-08/task-09)
- [ ] task-08: Update existing registry test for the 12-type reality — pending
- [ ] task-09: Fixture tests for the 10 new types through the existing audit — pending
- [ ] task-10: Package README update — pending
