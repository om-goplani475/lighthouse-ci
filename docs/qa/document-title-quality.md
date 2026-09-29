# QA checklist: Document Title Quality

- slug: document-title-quality
- merged: fa7bcaf (committed directly to phase-1-page-metadata — no feature branch this time,
  cutting pipeline overhead further per developer instruction)
- built without the full `.ai-agents/` design-doc pipeline, same lightweight pass as
  `meta-description-identical-to-title`. Scope (which three checks to build) was confirmed with
  the developer via a blocking question before implementation.

## Verified live (real `lhci collect`)

- [x] **Normal, substantive title** (`"Buy Running Shoes Online"`, one `<title>` element):
      `score: 1`.
- [x] **Generic/placeholder title** (`"Untitled Document"`): `score: 0`, one row, "Generic/placeholder
      title".
- [x] **Two real `<title>` elements in `<head>`**: `score: 0`, one row, "Multiple <title> elements",
      `"Found 2 <title> elements..."`. Importantly this confirms headless Chrome's live DOM
      genuinely keeps both elements (`document.querySelectorAll('title').length` is real, not a
      theoretical browser-parser-dependent assumption) — not something a unit test alone could
      settle.

## Verified in unit tests (8 cases in `document-title-quality.test.js`, plus 1 new pixel-width
gatherer pass-through test for `titleElementCount`)

- [x] Placeholder matching is case-/whitespace-insensitive.
- [x] Too-short threshold (10 chars) fires independently of the placeholder list.
- [x] Multiple issues can be reported together (a title that's both generic and duplicated as a
      `<title>` element).
- [x] `notApplicable` only when title is absent **and** `titleElementCount <= 1` — a page with an
      empty title but multiple `<title>` elements is still flagged for the structural issue, not
      waved through as not-applicable.

## Integration

- [x] `lighthouse-config.test.js` extended — audit registered in `audits`/`seo-extended.auditRefs`
      alongside all six pre-existing entries.
- [x] No new gatherer — extended `PixelWidth`'s existing artifact with one more field
      (`titleElementCount`), read in the same DOM round-trip. `pixel-width-truncation`'s own audit
      and tests are unaffected (it destructures only `title`/`description`, ignoring the new field).

## Regression

- [x] `npm run test:typecheck`, `npm run test:lint` clean.
- [x] Scoped `npx jest packages/seo-audits` — all 14 suites, 106/106 passing (one test fixture had
      to be corrected during this pass — see below — not a code bug).

## One thing worth recording: a test fixture bug caught by the test itself

The first version of the "can report multiple distinct issues at once" test used the title
`"Home"` with two `<title>` elements, expecting exactly two flagged rows (generic + multiple). The
test failed — correctly — because `"Home"` is *also* under the 10-character threshold, so a third
row (`"Title too short"`) is genuinely correct behavior. Fixed by switching the fixture to
`"Untitled Document"` (generic, but not too-short), which isolates the two issues the test actually
means to check. Not a design flaw: three independent checks firing together on a title that
happens to trip all three is exactly right.

## Summary

Scored normally, no approximate-ruleset caveat (same reasoning as
`meta-description-identical-to-title`). No gaps considered blocking.
