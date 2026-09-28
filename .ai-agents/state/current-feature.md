# Current feature

- slug: structured-data-rule-engine
- stage: 09-changelog-complete
- spec: docs/feature-specs/structured-data-rule-engine.md
- audit_spec: docs/audit-specs/structured-data-rule-engine.md
- contract: docs/feature-contracts/structured-data-rule-engine.md
- task_sequence: docs/task-sequences/structured-data-rule-engine.md
- base_commit: 5125783
- merged_head: bce25fb
- qa: docs/qa/structured-data-rule-engine.md
- security_review: recorded in .ai-agents/state/security-findings.md, 2026-09-28, no findings
- ci_integration: recorded in .ai-agents/state/ci-backlog.md, 2026-09-28, no gap found
- changelog: recorded in .ai-agents/state/changelog-draft.md, under Unreleased

Feature complete — all 9 stages run, QA verified live via real lhci collect/assert.

<!-- structured-data-schema-properties (feature #2) paused 2026-09-28: superseded by this feature.
Its intake spec (docs/feature-specs/structured-data-schema-properties.md) remains as reference for
the desired property-validation behavior; this feature builds the real audit under the same id,
scoped to Product+Article only. Remaining 10 types become ruleset data additions once this ships, not
new audit code. See docs/architecture/structured-data-rule-engine.md for the full decision record. -->

<!-- Previous feature structured-data-validation closed 2026-09-27: complete, all 9 stages run, see
docs/qa/structured-data-validation.md. Previous-previous feature missing-meta-description closed
2026-09-27: already satisfied by upstream, no implementation done. -->

<!-- See docs/roadmap.md for the full structured-data feature breakdown this is part of. -->
