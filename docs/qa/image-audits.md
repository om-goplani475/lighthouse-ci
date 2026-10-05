# QA — image audits (Phase 10)

Seven audits: `image-alt-quality`, `image-filename-quality`, `image-lazy-above-fold`, `image-dimensions-attributes`, `image-oversized`, `image-legacy-formats`, `broken-images`.

## Verified (2026-10-05)

- [x] Unit tests: `test/lib/images.test.js` (every rule at its boundary, applicability, malformed input, the row cap), `test/gatherers/image-alt-text.test.js`, config tests. `seo-audits`: 86 suites / 1,727 tests, typecheck and lint clean.
- [x] Live `lhci collect` with the fork config against a planted site with real PNGs: on the bad page all seven audits failed with the expected rows (a file-name alt, the same alt on 3 images, a camera-named file, a lazy image at the top, no dimensions, a 300 px image shown at 100 px, a 264 KiB PNG, a 404 image); on the clean page six passed and the lazy audit passed with the image below the fold and failed with it at 413 px of an 823 px viewport.
- [x] `lhci assert` gated on the audit ids and exited 1 on the failing one.

## Not verified

- Real sites (A6): false positives for alt heuristics and `image-oversized`; sites with many CSS images.
- `packages/viewer` rendering (A1).
- JPEG and WebP files (only PNG was served in the live run; the MIME rule is unit-tested).
