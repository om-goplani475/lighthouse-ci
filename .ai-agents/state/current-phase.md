# Current phase

No active phase branch right now.

- phase: 2 (structured data) — in progress, but staying on the pre-phase-branch model (see below),
  not using a `phase-2-structured-data` branch
- roadmap: docs/phases/phase-2-structured-data.md

<!--
Format once a phase branch is actually active (from phase 1 onward, or whichever phase is picked
up next — decided 2026-09-29 not to retroactively branch phase 2, since its foundational work was
already merged straight to main before this convention existed):

# Current phase

- phase: {n}
- slug: {kebab-slug}
- branch: phase-{n}-{kebab-slug}
- roadmap: docs/phases/phase-{n}-{kebab-slug}.md
- status: in-progress

Read by Agent 04 (.ai-agents/agents/04-implementer.md) at Step 1 — if this file names an active
branch, feat/{slug} branches off it and merges back into it (not main). If this file says "no
active phase branch," Agent 04 behaves exactly as it always has: branch off main, merge to main.

The phase branch itself only merges into main once every item in its docs/phases/{file}.md is
either done or explicitly moved to Deferred/To do later/Not possible — see AGENTS.md's "Phase
branches" section for the full close-out procedure.
-->
