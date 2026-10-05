# QA — content quality audits (Phase 14)

`placeholder-content`, `content-dates` (scored); `readability-score`, `hidden-text`, `keyword-alignment` (informational).

## Verified (2026-10-05)

- [x] Unit tests: `test/lib/content-placeholder.test.js` (each pattern, ordinary words not matched, one row per kind, hostile text), `content-dates.test.js` (parsing, JSON-LD in a `@graph`, each contradiction, a day of tolerance, time elements not judged), `content-readability.test.js` (syllables, easy versus difficult text, English variants, too little text, one huge word), `content-hidden-keywords.test.js`, `test/gatherers/page-content.test.js`, config tests. `seo-audits`: 106 suites / 1,919 tests, typecheck and lint clean.
- [x] Live `lhci collect` with the fork config against a planted site (port 9524):

  | Page | Result |
  |---|---|
  | `/blog/red-running-shoes` (a clean English article, consistent meta and JSON-LD dates) | everything passes; dates "last modified 2026-09-20 (15 days ago)"; keyword table shows red / running / shoe in all three |
  | `/blog/bad` (lorem ipsum and "your text here", modified before published, two different published dates, three hidden-text tricks plus decoys) | `placeholder-content` fails (2 rows); `content-dates` fails (2 contradictions); `hidden-text` reports 33 words hidden by a 1 px font, same colour as the background and off-screen, and **does not count** the screen-reader-only text, the `<details>` accordion or the `display:none` block |
  | `/fr` (a French page) | `readability-score` not applicable ("calibrated for English; this page declares lang=fr"); `content-dates` not applicable (no dates) |

## Not verified

- Real sites (A6): false positives for `placeholder-content` (a page about templates), `hidden-text` (CSS-driven effects, text over images) and the readability numbers on real prose.
- `packages/viewer` rendering of these tables.
