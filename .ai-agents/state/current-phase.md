# Current phase

- phase: 1
- slug: page-metadata
- branch: phase-1-page-metadata
- roadmap: docs/phases/phase-1-page-metadata.md
- status: in-progress

Opened 2026-09-29 — the first phase to use the phase-branch workflow (see `AGENTS.md`'s "Phase
branches" section). Agent 04 (`.ai-agents/agents/04-implementer.md`, Step 1) branches every
`feat/{slug}` off `phase-1-page-metadata`, not `main`, while this file says so.

<!-- Phase 2 (structured data) stays on the plain feat/{slug} -> main flow, no phase branch — see
docs/phases/phase-2-structured-data.md for why (built before this convention existed, decided
2026-09-29 not to retroactively branch it). -->

<!-- When phase 1 closes out (every item in docs/phases/phase-1-page-metadata.md is done, deferred,
to-do-later, or not-possible): ff-merge phase-1-page-metadata into main, delete the branch, clear
or update this file to the next phase. See AGENTS.md's "Phase branches" section, step 4-5. -->
