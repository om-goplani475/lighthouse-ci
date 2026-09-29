# Current feature

- slug: structured-data-type-conflicts
- stage: 04-implemented-merged
- spec: docs/feature-specs/structured-data-type-conflicts.md
- audit_spec: docs/audit-specs/structured-data-type-conflicts.md
- contract: docs/feature-contracts/structured-data-type-conflicts.md
- task_sequence: docs/task-sequences/structured-data-type-conflicts.md
- base_commit: 71e55b5
- merged_head: 19cbbc2
- qa: docs/qa/structured-data-type-conflicts.md
- security_review: recorded in .ai-agents/state/security-findings.md, 2026-09-29, one low finding, fixed same sitting (prototype-safe objects, commit 19cbbc2)
- ci_integration: recorded in .ai-agents/state/ci-backlog.md, 2026-09-29, no gap found

Merged, QA verified live via real lhci collect/assert (including confirming duplicate-count DOES
meaningfully fail lhci assert, unlike the prior feature's informative-only audit). /write-changelog
still to run.

<!-- structured-data-rich-result-eligibility closed 2026-09-29: complete, all 9 stages run, merged
62d659c, QA'd live, see docs/qa/structured-data-rich-result-eligibility.md. Shipped the per-type
eligibility inventory, which unblocked this feature. -->

<!-- structured-data-remaining-types closed 2026-09-28: complete, all 9 stages run, merged 00e6f71,
QA'd live, see docs/qa/structured-data-remaining-types.md. Shipped all 10 remaining tracked types as
pure ruleset data, confirming the rule-engine's data-only design promise. -->

<!-- structured-data-rule-engine closed 2026-09-28: complete, all 9 stages run, merged bce25fb,
QA'd live, see docs/qa/structured-data-rule-engine.md. Shipped the rule-engine foundation plus the
real structured-data-schema-properties audit for Product+Article. -->

<!-- structured-data-schema-properties (original feature #2, all 12 types) paused 2026-09-28:
superseded by structured-data-rule-engine, then further split into structured-data-remaining-types
(now closed, see above). The original spec (docs/feature-specs/structured-data-schema-properties.md)
remains as reference. See docs/architecture/structured-data-rule-engine.md for the full decision
record. -->

<!-- Previous feature structured-data-validation closed 2026-09-27: complete, all 9 stages run, see
docs/qa/structured-data-validation.md. Previous-previous feature missing-meta-description closed
2026-09-27: already satisfied by upstream, no implementation done. -->

<!-- See docs/roadmap.md for the full structured-data feature breakdown this is part of. -->
