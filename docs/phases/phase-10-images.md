# Phase 10 — Images

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-10-images` (off `main`), the ninth phase to use the phase-branch workflow. Merges into `main` once built, QA'd and approved.

**Status: done (2026-10-05): built, QA'd live and merged into `main`; recalibrated on 2026-10-06 (horizontal viewport test, CSS sizes accepted, 3.5x oversize, other-site images are notes, `image-filename-quality` and `image-legacy-formats` informational).**

## Planning decisions (2026-10-05, lightweight with a short design conversation)

Lighthouse core already ships audits for missing width/height (`unsized-images`), oversized images (`image-size-responsive`, `uses-responsive-images`), legacy formats (`modern-image-formats`, `uses-optimized-images`), a lazy LCP image (`lcp-lazy-loaded`) and a missing alt (`image-alt`). Decisions with the developer:

1. **Build SEO-flavoured versions of the three overlapping rows** (different thresholds, stated in each audit), not skip them.
2. **Build all four new audits**: images returning 4xx/5xx, alt text quality, lazy-loading above the fold, file-name descriptiveness.
3. **Which images**: content images, plus CSS backgrounds for the file-name rule (they have no alt).
4. **Scoring**: binary, fail on any offender.

Thresholds I set and stated (not asked): content image = at least 50 x 50 px; oversized = more than 2x wider and at least 100 px wider; legacy = JPEG/PNG/GIF over 10 KiB; alt over 125 characters or the same alt on 3 or more different images.

## Features

| Roadmap row | Status | Audit |
|---|---|---|
| Missing/empty alt attributes + quality heuristic | **done** | `image-alt-quality` (a missing alt stays with core `image-alt`) |
| Images returning 4xx/5xx | **done** | `broken-images` (network log, no extra request) |
| Missing explicit width/height | **done** | `image-dimensions-attributes` |
| Oversized images relative to rendered dimensions | **done** | `image-oversized` |
| Inefficient/legacy image formats | **done** | `image-legacy-formats` |
| Inappropriate lazy-loading above the fold | **done** | `image-lazy-above-fold` |
| Filename descriptiveness heuristic | **done** | `image-filename-quality` |

Code: `lib/images.js` (all seven builders), `gatherers/image-alt-text.js`, seven thin audits.

## How the plan changed while building

- A planted test page without `<meta name="viewport">` made the lazy-loading audit flag an image 1,263 px down: mobile Chrome lays such a page out 980 px wide, so the emulated viewport is 1,958 px tall. It is genuine browser behaviour, not a bug (core's `offscreen-images` reads the same value); documented in the audit and README, and the page was fixed.

## Known limits

- Single page only: images of other crawled pages are not judged.
- `image-legacy-formats` ignores image size relative to display; `image-oversized` ignores the device pixel ratio (a 2x factor covers common retina screens).
- CSS images are only read by the file-name rule.
