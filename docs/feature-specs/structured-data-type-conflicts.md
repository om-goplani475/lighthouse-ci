# Feature: Duplicate and Conflicting `@type` Detection

- slug: structured-data-type-conflicts
- requested: 2026-09-29
- type: new-audit

## Summary

Roadmap feature #3. Two distinct checks, decided at Gate 0 to build together in one feature (not
split into two, per explicit developer choice — flagged here since it was the higher-risk option of
the three offered):

1. **Duplicate-count**: a schema type Google's guidance expects to appear at most once per page
   (e.g. `Organization`) appears more than once. Reuses the exact per-type grouping
   `structured-data-rich-result-eligibility` already built (`Map<type, {count, ...}>`), which is what
   unblocked this feature.
2. **Conflicting-entity**: two or more blocks of the same type appear to describe the same
   real-world entity but disagree on field values (e.g. two `Product` blocks with the same `name`
   but different `price`).

These get different severity treatment (decided at Gate 0):
- **Duplicate-count**: scored, can fail the audit. Low false-positive risk — counting is
  unambiguous, and the set of "should be singular" types is a narrow, well-understood list.
- **Conflicting-entity**: informational only, same `scoreDisplayMode: informative` pattern as
  `structured-data-rich-result-eligibility`. This was not explicitly asked at Gate 0 (the developer
  deferred to "what's recommended"), but it follows directly from the false-positive risk already
  acknowledged when choosing to build this alongside duplicate-count: guessing "these two blocks
  describe the same entity" from field overlap is inherently fuzzy, and failing a page's score on a
  fuzzy heuristic is a materially different risk than reporting it. If Gate 1 disagrees and wants
  conflicting-entity scored too, that's a real design reversal worth a fresh explicit decision, not
  something to slip in during implementation.

## Concrete pass/fail example

**Duplicate-count** (scored):
- **Pass**: a page has exactly one `Organization` block.
- **Fail**: a page has two `Organization` blocks (e.g. one in the header template, one accidentally
  duplicated in a footer include) — audit fails, report names the type and the count found.
- **Not applicable**: a page has zero blocks of any "should be singular" type, or every such type
  appears exactly once or zero times (no duplicates to report) — **not applicable** only applies
  when there's nothing to check at all (matches the narrower not-applicable convention
  `structured-data-rich-result-eligibility` established); a page with everything correctly
  non-duplicated should score 1, not not-applicable.

**Conflicting-entity** (informational):
- **Reports**: a page has two `Product` blocks, both with `name: "Widget"` but
  `offers.price: "9.99"` on one and `offers.price: "14.99"` on the other — reported as a likely
  conflict (same apparent entity, disagreeing field), never affects score.
- **Deliberately not reported as a conflict**: two `Product` blocks with different `name` values
  (e.g. a product listing page with `"Widget"` and `"Gadget"`) — these are legitimately different
  entities, not a conflict. Getting this distinction wrong in either direction (flagging legitimate
  multi-product pages, or missing a real accidental duplication) is the core risk this feature
  carries; the exact matching heuristic (which fields establish "same entity" per type) is
  Agent 01's job to design carefully, not decided here.

## Gatherer needs

- New gatherer required: **no**. Reuses the existing `StructuredDataJsonLd` gatherer, same as all
  three existing structured-data audits.
- New rule-engine/ruleset content: **duplicate-count needs new ruleset data** (which types are
  "should be singular" — a new small ruleset, structure TBD by Agent 01; the developer explicitly
  deferred the exact type list to design time rather than locking it at intake).
  **Conflicting-entity likely needs no ruleset data** — the matching heuristic is closer to engine
  logic (which fields to compare per type) than versioned external-guidance data, but Agent 01 should
  confirm this rather than assume it.

## Scope

- Package(s) affected: `packages/seo-audits`
- New audit, separate from the three existing structured-data audits — all four independently
  consume the same `StructuredDataJsonLd` gatherer artifact.
- Out of scope (explicitly):
  - Cross-checking structured data against visible page content (roadmap feature #4, deferred
    separately — this feature only compares JSON-LD blocks against each other, never against the
    DOM).
  - Any change to the `google-requirements`/`schema-org`/`eligibility` rule-engine namespaces — this
    is either a new, fourth namespace or audit-local logic; not a modification of the existing three.
  - Fixing/resolving conflicts automatically — report-only, same as every other audit in this
    package.

## Open questions (for Agent 01 — flagging per `.ai-agents/prompts/blocking-questions.md`: if any of
these turns out to have more than one reasonable answer with real build consequences, ask the
developer before designing around a guess)

- **Singular-type list**: which schema types count as "should appear at most once per page"?
  Developer explicitly deferred this to design time. Needs grounding in Google's actual published
  guidance per type, not assumption — `Organization` is the clearest case; `WebSite` and
  `BreadcrumbList` were both raised as candidates during intake but not decided.
- **Entity-matching heuristic for conflicting-entity detection** — the single hardest design decision
  in this feature. What fields establish "these two blocks likely describe the same entity" per
  type? (e.g. `Product`: matching `name` + `sku`/`gtin` if present? `Organization`: matching `name`
  or `url`?) Getting this wrong produces either noisy false positives (annoying, erodes trust in the
  audit) or silent false negatives (misses real mistakes) — this is exactly the kind of "more than
  one reasonable answer that changes what gets built" case `blocking-questions.md` describes; Agent
  01 should treat this as a strong candidate for asking the developer directly rather than picking a
  heuristic and documenting it as a recommendation.
- **Per-block vs per-page reporting shape**: does a duplicate-count row need to name *which* blocks
  (by index) are the duplicates, or just the type and count? Does a conflicting-entity row need to
  show both blocks' differing field values side by side, or just flag that a conflict exists?
