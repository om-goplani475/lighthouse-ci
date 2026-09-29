# Current feature

- slug: pixel-width-truncation
- stage: 04-implemented-merged
- spec: docs/feature-specs/pixel-width-truncation.md
- audit_spec: docs/audit-specs/pixel-width-truncation.md
- contract: docs/feature-contracts/pixel-width-truncation.md
- task_sequence: docs/task-sequences/pixel-width-truncation.md
- phase: 1 (page-metadata) — see .ai-agents/state/current-phase.md; branch was
  feat/pixel-width-truncation off phase-1-page-metadata, not off main
- base_commit: 1729f7c904bc0ba44ed753c6aa3dc19d9f251e05 (phase-1-page-metadata, at branch creation)
- merged: 5fea5d1 (fast-forward into phase-1-page-metadata, merged locally — no PR/CI gate for this
  one, per explicit developer instruction to merge locally and push directly)

<!-- Next: /write-qa and /security-review, per AGENTS.md's "merged != done" rule — not deferred. -->

<!-- structured-data-type-conflicts closed 2026-09-29: complete, all 9 stages run, merged 19cbbc2
(includes a post-merge prototype-safety security fix), QA'd live, see
docs/qa/structured-data-type-conflicts.md. Last feature of Phase 2 (structured data) before Phase 1
was picked up. Corrected here: this file's `stage` field was left stale at `04-implemented-merged`
after that feature actually completed all 9 stages — the prose said so but the field didn't; fixed
by writing this fresh file rather than perpetuating the mismatch. -->

<!-- structured-data-rich-result-eligibility closed 2026-09-29: complete, all 9 stages run, merged
62d659c, QA'd live, see docs/qa/structured-data-rich-result-eligibility.md. -->

<!-- structured-data-remaining-types closed 2026-09-28: complete, all 9 stages run, merged 00e6f71,
QA'd live, see docs/qa/structured-data-remaining-types.md. -->

<!-- structured-data-rule-engine closed 2026-09-28: complete, all 9 stages run, merged bce25fb,
QA'd live, see docs/qa/structured-data-rule-engine.md. -->

<!-- structured-data-schema-properties (original feature #2, all 12 types) paused 2026-09-28:
superseded by structured-data-rule-engine, then further split into structured-data-remaining-types
(now closed). The original spec (docs/feature-specs/structured-data-schema-properties.md) remains
as reference. See docs/architecture/structured-data-rule-engine.md for the full decision record. -->

<!-- Previous feature structured-data-validation closed 2026-09-27: complete, all 9 stages run, see
docs/qa/structured-data-validation.md. Previous-previous feature missing-meta-description closed
2026-09-27: already satisfied by upstream, no implementation done. -->

<!-- See docs/phases/phase-2-structured-data.md for the full structured-data feature breakdown
(Phase 2, closed out 2026-09-29). See docs/phases/phase-1-page-metadata.md for Phase 1, the phase
this current feature is part of. -->
