# QA checklist: H1 Count and H1-Title Relevance

- slugs: document-h1-count, h1-title-relevance (built together, share the new `Headings` gatherer)
- merged: 3e180ac (committed directly to phase-1-page-metadata, lightweight pass, same as items
  1b/2)
- checked what Lighthouse core already covers before designing (same discipline as
  `missing-meta-description`/`document-title-quality`): core's `heading-order` audit (axe) already
  flags skipped heading levels (`currLevel - prevLevel <= 1` check, read directly from
  `node_modules/axe-core/axe.js`), and `empty-heading` already flags empty headings. So this pass
  only covers H1 **count** and title **relevance**, not order/emptiness.
- scope for the fuzzy "H1-vs-title relevance" check was confirmed with the developer via a
  blocking question first: build it as a purely informational heuristic, not scored.

## Verified live (real `lhci collect`, 4 test pages)

- [x] **Normal page** (one H1 sharing words with the title): `document-h1-count` score 1,
      `h1-title-relevance` no rows.
- [x] **Missing H1**: `document-h1-count` score 0, explanation "no `<h1>` element"; relevance
      `notApplicable` (nothing to compare).
- [x] **Two `<h1>` elements**: `document-h1-count` score 0, explanation "2 `<h1>` elements... ambiguous
      which one is the actual main heading"; `h1-title-relevance` independently checked **both**
      H1s against the title, both flagged. Confirms headless Chrome's live DOM genuinely keeps
      both H1 elements queryable (`document.querySelectorAll('h1').length === 2`), not a
      theoretical browser-parsing assumption.
- [x] **One H1, unrelated to title** (`"Welcome to Our Bakery"` vs. `"Buy Running Shoes Online"`):
      `document-h1-count` score 1 (count is fine), `h1-title-relevance` flags the H1 — the exact
      case this check exists for, confirmed working end to end, not just in a mocked unit test.

## Verified in unit tests

- `headings.test.js` (3 cases) — gatherer pass-through only, mechanism itself proven live above.
- `document-h1-count.test.js` (3 cases) — 0/1/many H1 counts.
- `h1-title-relevance.test.js` (7 cases) — word-overlap match, no-overlap flag, stopword-only
  texts produce no false signal either way, multiple H1s checked independently, notApplicable when
  title or H1 absent, confirmed `scoreDisplayMode: 'informative'`.

## Integration

- [x] `lighthouse-config.test.js` extended — both audits and the new `Headings` gatherer/artifact
      registered, all nine audits present alongside `extends: 'lighthouse:default'`.
- [x] `h1-title-relevance` requires both the new `Headings` artifact and the existing `PixelWidth`
      artifact (for title text) — cross-gatherer dependency confirmed working live (the "one H1,
      unrelated to title" case above exercises exactly this).

## Regression

- [x] `npm run test:typecheck`, `npm run test:lint` clean.
- [x] Scoped `npx jest packages/seo-audits` — 17 suites, 119/119 passing, zero regressions.

## Summary

`document-h1-count` is scored normally (unambiguous — either the count is 1 or it isn't).
`h1-title-relevance` is informational only and explicitly documented as a weak signal (word
overlap is not a real relevance judgment) — its own `description` string and this package's README
both say so, so a report reader doesn't mistake a flagged row for a confirmed problem. No gaps
considered blocking.
