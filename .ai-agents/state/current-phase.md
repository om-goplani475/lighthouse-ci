# Current phase

- phase: none active — see below
- status: n/a

<!-- Phase 1 (page-metadata) closed 2026-09-30: every item (0-6) done or closed-no-build-needed,
ff-merged into main (a1e8313), branch phase-1-page-metadata deleted. See
docs/phases/phase-1-page-metadata.md for the full breakdown, including its "To do later" table of
basic-vs-advanced choices made along the way. -->

<!-- Phase 2 (structured data) has remaining Deferred/To-do-later items (see
docs/phases/phase-2-structured-data.md) but was never given its own phase branch (built before the
phase-branch convention existed, decided 2026-09-29 not to retroactively branch it) — any further
Phase 2 work continues on the plain feat/{slug} -> main flow, same as before. All six scoped items
done as of 2026-09-30 (item 6, structured-data-deprecated-properties, merged c2fb340). -->

<!-- Phase 3 (social/sharing metadata) closed 2026-09-30: all five items done. Items 1-4 built
lightweight-mode; item 5 (social preview renderer) got a short design conversation, which surfaced
a real architectural finding — a true visual render isn't achievable inside a standard Lighthouse
report without editing packages/viewer (against this fork's own boundary rule) — and was scoped
down to a text-based preview-content report instead, confirmed via blocking question. Also found
and fixed a real pre-existing bug in safe-fetch.js's safeLookup (broke every real outbound fetch to
a non-literal-IP hostname) during item 3's live QA. ff-merged into main, branch
phase-3-social-metadata deleted. See docs/phases/phase-3-social-metadata.md for the full
breakdown. -->

<!-- When the next phase starts: if it gets a phase branch, update this file the same way
phase-1-page-metadata's/phase-3-social-metadata's entries looked (phase/branch/roadmap/status:
in-progress) and Agent 04 branches feat/{slug} off it per AGENTS.md's "Phase branches" section. -->
