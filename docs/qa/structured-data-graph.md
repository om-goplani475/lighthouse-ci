# QA checklist: `@graph` Container and `@id` Reference Support

- slug: n/a (extends all four structured-data audits, no new audit id)
- built with a short upfront design conversation before code (not the full 9-stage pipeline, but
  not lightweight-mode-straight-to-code either) — per the earlier agreement that Phase 2's "not
  yet scoped" items (5, 6) warrant real design thought first, unlike the rest of Phase 1/most of
  Phase 2.
- scope confirmed with the developer via a blocking question: build both `@graph` unwrapping *and*
  `@id` reference resolution (the "advanced" option), not unwrapping alone.

## What was actually wrong before this (not just unscoped — a real bug)

Investigated before designing anything: `schema-org-engine.js`'s `universal.required` check
(`@context`+`@type`) has no concept of a `@graph` container, which has no top-level `@type` by
design. Confirmed via code reading, then via a live test, that this meant:

- `structured-data-json-ld` **actively misreported** a valid, standard `@graph`-wrapped block as
  invalid JSON-LD ("Missing @type") — a false positive on a common real-world pattern (Yoast SEO
  and others emit `@graph` routinely).
- `structured-data-schema-properties`, `structured-data-rich-result-eligibility`, and
  `structured-data-type-conflicts` each independently did `typeof parsed['@type'] !== 'string' →
  skip`, so every entity inside a `@graph` was **silently invisible** to all three — no false
  failure, just a real, unadvertised coverage gap.

## What changed

- `src/rule-engine/schema-org-engine.js` — `validate()` now branches on whether the block has a
  `@graph` array; if so, checks `@context` at the container level and `@type` on each entry
  (indexed error messages), rather than requiring `@type` on the container itself.
- New `src/lib/json-ld-graph.js` (`extractTypedEntities`) — the shared replacement for the three
  audits' previous inline `@type` check. Unwraps `@graph` into individual typed entities, and
  resolves bare `{"@id": ...}` reference properties against sibling entities in the same graph,
  one level deep.
- `structured-data-schema-properties.js`, `structured-data-rich-result-eligibility.js`,
  `structured-data-type-conflicts.js` — each swapped its own `isObject`/`tryParse`/`@type` check
  for `extractTypedEntities`, iterating the returned entities instead of raw blocks. No other
  logic in any of the three changed — same per-entity processing as before, just fed entities from
  a richer source.
- `structured-data-json-ld.js` — unchanged; it already delegated validity entirely to
  `schema-org-engine.js`, so the container-recognition fix required no changes there.

## A real typecheck issue caught and fixed along the way

`schema-org-engine.js`'s new module-doc comment (a `/** */` JSDoc block) originally referenced
`@context`/`@type`/`@graph` as literal `@`-prefixed tokens in prose. TypeScript's JSDoc comment
scanner treats a bare `@word` as a potential tag start, and misparsed the comment, throwing a real
`TS1110: Type expected` compile error — not a lint nitpick, a build-breaking mistake. Fixed by
rewording the comment to avoid literal `@`-prefixed schema.org property names in `/** */` blocks
(spelled out as "context field"/"type field" instead) — worth remembering for any future comment
in this codebase that needs to discuss JSON-LD's `@`-prefixed keywords.

## Verified in unit tests

- `json-ld-graph.test.js` (12 cases) — unwrapping (multiple entities, untyped entries skipped,
  empty `@graph`), reference resolution (direct property, array-valued property, unresolvable
  reference left as-is, an inline node with its own `@id` not mistaken for a reference, one-level
  depth limit confirmed — a resolved node's own reference is not itself chased).
- `schema-org-engine.test.js` (+5 new cases) — container validity: passes a well-formed container,
  flags missing container-level `@context`, flags an empty `@graph`, flags a `@graph` entry
  missing its own `@type` with the correct index, confirms `@context` is *not* required on each
  entry (inherited from the container).
- Each of the four audits' own test files got at least one `@graph`-specific fixture test added
  (not just relying on the shared module's isolated tests):
  - `structured-data-json-ld.test.js`: a valid `@graph` container now passes; one with an untyped
    entry still fails, correctly.
  - `structured-data-schema-properties.test.js`: an `@graph` with a valid `Product` and an
    `Article` missing `datePublished` correctly fails on the Article specifically; a `Product`
    whose `offers` is only an `{"@id": ...}` reference to a sibling `Offer` entity passes (proving
    resolution feeds into the nested-required check correctly).
  - `structured-data-rich-result-eligibility.test.js`: both entities inside one `@graph` are
    reported.
  - `structured-data-type-conflicts.test.js`: two `Organization` entities declared inside one
    `@graph` are correctly flagged as a duplicate.
- All pre-existing tests across all four audits and both engines pass unchanged — confirms nothing
  about single-block (non-`@graph`) behavior regressed.

## Verified live (real `lhci collect`) — the case unit tests structurally can't fully prove

A single test page's `@graph` block declared, in order: an `Organization` (with its own `@id`), an
`Offer` (with its own `@id`, untracked type), a `Product` whose `offers` is *only* `{"@id":
"#offer1"}` (a reference, not inlined), and an `Article` referencing the `Organization` as
`publisher`.

- [x] `structured-data-json-ld`: `score: 1` — the container itself no longer flagged invalid.
- [x] `structured-data-schema-properties`: **`score: 1`** — this is the load-bearing result. If
      `@id` resolution weren't actually wired through to the nested-required check correctly (e.g.
      a subtle object-identity or ordering bug), the `Product`'s `offers.price`/`priceCurrency`/
      `availability` would all read as missing against the bare reference stub and the audit would
      fail. It didn't — confirming resolution genuinely reaches the check that matters, live, not
      just in a mocked/isolated unit test.
- [x] `structured-data-rich-result-eligibility`: all four entities reported, including the
      untracked `Offer` type shown as `tracked: 'No'` rather than silently absent — confirms
      unwrapping surfaces *every* entity, tracked or not, matching the audit's own documented
      "complete inventory" behavior.

## Regression

- [x] `npm run test:typecheck`, `npm run test:lint` clean.
- [x] Scoped `npx jest packages/seo-audits` — 27 suites, 223/223 passing, zero regressions in any
      pre-existing single-block test case.

## Summary

Closes both halves of Phase 2 item 5 (unwrapping and reference resolution), and fixes a real
false-positive that predates this feature, not introduced by it. No gaps considered blocking. Item
6 (schema.org version awareness, deprecated-property detection) remains the last "not yet scoped"
item in Phase 2, still intentionally untouched here.
