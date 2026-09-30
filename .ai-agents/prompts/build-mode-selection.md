# Build mode selection

Read before starting work on any roadmap item (a phase-tracker row, a `docs/master-roadmap.md`
checklist item). Decides which of three build modes an item gets — this choice isn't written down
anywhere else, and picking wrong wastes either the developer's token budget (over-processing a
simple check through the full pipeline) or produces rework (under-processing something with a real
unresolved design fork).

## The three modes

**1. Full 9-stage pipeline** (`/intake` → `/design-audit`+`/design-contract` → `/sequence-tasks` →
`/implement` → `/write-qa` → `/security-review` → `/ci-integration` → `/write-changelog`, with
Gate 0-3 checkpoints between stages).

Use when an item is genuinely novel for this codebase — no existing audit/gatherer pattern to
follow — and/or introduces a new architectural capability. Real examples from this project's
history: `pixel-width-truncation` (the first new gatherer built since `structured-data-json-ld`,
required designing real in-browser canvas measurement from scratch); the structured-data rule
engine itself (a new versioned-registry architecture, not just a new check).

**2. Lightweight mode** (no formal `.ai-agents/` design docs — implement directly, still with full
test coverage, live QA, and README/tracker updates).

Use when an item is concrete and bounded: it follows an existing pattern in this codebase closely
enough that there's no real design fork to resolve, just implementation. This was explicitly
requested by the developer (2026-09-29) specifically to cut token spend on simple, low-ambiguity
single-page checks — see `docs/phases/phase-1-page-metadata.md`'s items 2-6 for the precedent
(document-title-quality, H1 checks, robots-directives, canonical-https, favicon/manifest), and
Phase 2 item 4 (datatype validation) and Phase 3 items 1-4 (Open Graph/Twitter Card completeness)
for later applications of the same call.

Lightweight mode still asks a blocking question (`blocking-questions.md`) whenever a real
scope/architecture fork comes up mid-implementation — "lightweight" means skipping the formal
*docs*, not skipping the discipline of confirming a genuine fork with the developer. It also still
gets the same live-`lhci collect` QA verification and security-checklist scrutiny as anything else
— "lightweight" is about process overhead, never about correctness or security rigor. The
`favicon-presence`/`manifest-icons` SSRF work (Phase 1 item 6) is the clearest example: built
lightweight, but reviewed "with real care, not lightweight-mode speed" specifically because it was
this package's first outbound-fetch capability.

**3. Short design conversation, then lightweight-mode code** (no formal docs, but a real
back-and-forth — usually 1-2 rounds of blocking questions — before any code, because the item as
originally phrased has more than one reasonable shape and picking wrong means real rework).

Use when an item is named in the roadmap but not yet concretely scoped — the roadmap bullet
describes an outcome, not a specific mechanism, and there's a genuine fork in what "done" even
means. Real examples: Phase 2 item 5 (`@graph`/`@id` handling — needed to decide unwrap-only vs.
unwrap+resolve-references before writing anything); Phase 2 item 6 (deprecated-property detection —
needed to decide type scope and scoring model); Phase 3 item 5 (social preview renderer — the
design conversation itself surfaced a real architectural constraint, that a true visual render
isn't achievable without editing `packages/viewer`, which reshaped what got built entirely).

## How to tell which mode an item needs

Ask, in order:

1. **Does this need a new capability this codebase doesn't have yet** (a new gatherer mechanism, a
   new architectural layer, a new class of external interaction)? → full pipeline.
2. **Is the roadmap bullet a specific, checkable claim** ("X returns 200", "X matches Y") that maps
   cleanly onto an existing audit/gatherer pattern already in this codebase? → lightweight mode,
   straight to code.
3. **Otherwise** — the bullet names an outcome without a settled mechanism, or a real fork in scope
   exists (which properties, which platforms, how deep to resolve, scored vs. informational) → a
   short design conversation (blocking questions) first, then lightweight-mode code once resolved.

When in doubt between modes 2 and 3 for a batch of items, it's fine to split the batch — build the
concretely-scoped ones in lightweight mode first, and hold the genuinely-unscoped ones for a design
conversation. This is exactly what happened with Phase 2 items 4/5/6 and Phase 3 items 1-4/5: a
few bounded items shipped immediately while the harder ones got their own conversation.

## What never changes regardless of mode

Every item, in every mode, still gets: real test coverage (unit tests plus, where the audit can't
be exercised directly in Jest, the shell-out-to-real-node pattern — see `testing-patterns.md`),
live verification via a real `lhci collect` run before the QA doc is written (never assumed or
claimed before actually running it), a README update, and the phase tracker updated with rationale
— not just a checkbox flip. The mode only changes how much *design process* happens before code, not
how much *verification* happens after.
