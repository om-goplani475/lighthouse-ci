# QA checklist: Structured Data Property Datatype Validation

- slug: n/a (extension of `structured-data-schema-properties`, no new audit id)
- built via a lightweight pass (no formal `.ai-agents/` design docs), consistent with Phase 1's
  simple, low-ambiguity items — this was concrete and bounded per the phase tracker's own note
  ("a real, non-deferred gap"), not one of the "not yet scoped" items (5/6).

## What changed

- `src/rule-engine/types.js` — additive `datatypes?: Record<string, GoogleRuleSetDatatype>` field
  on both `GoogleRuleSetTypeRule` and `GoogleRuleSetNestedRule`.
- `rules/schema/google-structured-data-ruleset.schema.json` — additive `datatypes` property
  (`number`/`date`/`currency` enum) on both type-level and nested-rule schemas.
- `src/rule-engine/google-requirements-engine.js` — new `matchesDatatype`/`checkDatatypes`,
  wired into `validate()` at both the top level and per nested-instance level.
- `rules/google/structured-data/2026-10.json` — `datatypes` added to `Product.offers`
  (`price: number`, `priceCurrency: currency`), `Article` (`datePublished: date`), `Event`
  (`startDate: date`), `JobPosting` (`datePosted: date`), `VideoObject` (`uploadDate: date`),
  `Review.reviewRating` (`ratingValue: number`).
- No changes needed to `structured-data-schema-properties.js` (the consuming audit) — it already
  forwards whatever findings the engine returns generically; datatype findings use the same
  `google-requirements` namespace and same `Finding` shape as missing-property findings, so they
  flow through the existing table/scoring logic unchanged.

## Scope decisions

- **`number`** accepts both a JS number and a numeric string (schema.org's own spec allows either
  for `price`; the existing fixture tests already used string prices like `"9.99"`).
- **`date`** requires an ISO-8601-shaped string (date-only or with a time component), not just
  anything `Date.parse` happens to accept — deliberately rejects ambiguous formats like
  `"10/9/2026"` that `Date.parse` would silently accept as some date, just not necessarily the
  intended one.
- **`currency`** checks format only (3 uppercase letters) against ISO 4217's shape, not a real
  ~180-entry currency-code list — catches an obviously-wrong value (a currency symbol, lowercase,
  wrong length) without taking on a versioned currency-list dependency for what this feature needs.
- Datatype checks only fire when the property is **present** — a missing property stays
  `required`'s concern, avoiding double-reporting the same absence two ways.
- No new `Finding` namespace — reuses `google-requirements`, since a bad value is the same kind of
  "doesn't meet Google's structured-data requirements" concern as a missing one, and score
  composition (`anyRequirementFailure`) already works generically over whatever findings come back.

## Verified in unit tests (10 new cases in `google-requirements-engine.test.js`, all existing cases
still pass unchanged)

- [x] Non-numeric price (`"free"`) flagged with the exact concrete example the phase item names.
- [x] Numeric-string price (`"9.99"`) accepted — confirms the existing fixture data (which already
      used string prices) continues to pass with zero new false positives.
- [x] Malformed currency code (`"$"`) flagged.
- [x] Non-ISO-8601 date (`"10/9/2026"`) flagged; both a date-only and a date-time ISO string
      accepted.
- [x] Datatype check correctly skipped (not double-flagged) when the property is absent entirely —
      only the "Missing" finding fires.
- [x] Datatype checks apply per-instance when a nested property (`offers`) is an array — one bad
      price among several offers is flagged individually, not treated as an all-or-nothing check.

## Verified live (real `lhci collect`)

- [x] A `Product` block with `price: "free"` in its `offers`: `structured-data-schema-properties`
      scored 0, with a table row `{property: "offers.price", message: "offers.price should be a
      valid number, got \"free\""}` alongside any other findings — confirmed the new finding type
      renders correctly in the same report table as existing missing-property findings, no
      special-casing needed in the audit or report renderer.
- [x] The same page's `Article` block with a valid `datePublished` and a `Product` with a valid
      numeric price and currency: no datatype findings, `score: 1` (confirming no false positives
      against realistic valid data).

## Regression

- [x] `npm run test:typecheck`, `npm run test:lint` clean.
- [x] Scoped `npx jest packages/seo-audits` — all suites passing, including every pre-existing
      `google-requirements-engine`/`structured-data-schema-properties`/registry test unchanged.

## Summary

Additive throughout — no existing ruleset consumer, test, or audit behavior changed for data that
was already valid. Phase 2 item 4 closed. Items 5 (`@graph`/entity relationships) and 6 (schema.org
version awareness) remain "not yet scoped" and are intentionally not touched here — per the earlier
conversation, those need an upfront design discussion before code, not a lightweight pass.
