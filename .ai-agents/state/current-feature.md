# Current feature

- slug: structured-data-remaining-types
- stage: 04-implemented-merged
- spec: docs/feature-specs/structured-data-remaining-types.md
- audit_spec: docs/audit-specs/structured-data-remaining-types.md
- contract: docs/feature-contracts/structured-data-remaining-types.md
- task_sequence: docs/task-sequences/structured-data-remaining-types.md
- base_commit: f97606c
- merged_head: 00e6f71
- qa: docs/qa/structured-data-remaining-types.md
- security_review: recorded in .ai-agents/state/security-findings.md, 2026-09-28, no findings
- ci_integration: recorded in .ai-agents/state/ci-backlog.md, 2026-09-28, no gap found

Merged, QA verified live via real lhci collect/assert. /write-changelog still to run.

<!-- structured-data-rule-engine closed 2026-09-28: complete, all 9 stages run, merged bce25fb,
QA'd live, see docs/qa/structured-data-rule-engine.md. Shipped the rule-engine foundation plus the
real structured-data-schema-properties audit for Product+Article. -->

<!-- structured-data-schema-properties (original feature #2, all 12 types) paused 2026-09-28:
superseded by structured-data-rule-engine, then further split — this current feature
(structured-data-remaining-types) covers the remaining 10 types as ruleset-data-only additions.
The original spec (docs/feature-specs/structured-data-schema-properties.md) remains as reference
for the desired property-validation behavior per type. See
docs/architecture/structured-data-rule-engine.md for the full decision record. -->

<!-- Previous feature structured-data-validation closed 2026-09-27: complete, all 9 stages run, see
docs/qa/structured-data-validation.md. Previous-previous feature missing-meta-description closed
2026-09-27: already satisfied by upstream, no implementation done. -->

<!-- See docs/roadmap.md for the full structured-data feature breakdown this is part of. -->
