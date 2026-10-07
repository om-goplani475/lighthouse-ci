# Phase 14 — Content Quality

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-14-content` (off `main`). The tenth phase to use the phase-branch workflow.

**Status: Done (2026-10-05), merged into `main`.**

## Planning decisions (2026-10-05, lightweight with a plain-language design conversation)

1. **Build all four chosen checks**: placeholder text, dates and freshness, readability, hidden text. **Plus** a descriptive keyword-alignment comparison of the title, the first h1 and the URL.
2. **Strictness (informed by the 2026-10-05 review)**: fail only on clear mistakes: leftover placeholder text and impossible dates. Readability, hidden text, page age and keyword alignment are informational and never fail.
3. **Readability is English-only**: not applicable unless the page declares `lang="en"`.
4. The existing Phase 7 `thin-content` audit covers "short pages and word count"; it is left as it is (the review's softening of it is a separate item).

## Features

| Roadmap row | Status | Audit |
|---|---|---|
| Thin content / extremely short pages, word count | **already done** | `thin-content` (Phase 7) |
| Readability scoring | **done** | `readability-score` (informational) |
| Keyword presence alignment across title/H1/URL | **done** | `keyword-alignment` (informational, descriptive only) |
| Hidden text, lorem-ipsum/placeholder detection | **done** | `hidden-text` (informational), `placeholder-content` (scored) |
| Content freshness / date consistency | **done** | `content-dates` (scored) |

Code: `gatherers/page-content.js` (the main text, hidden-text signs, declared dates, title, h1, lang), `lib/content-common.js`, `content-placeholder.js`, `content-dates.js`, `content-readability.js`, `content-hidden.js`, `content-keywords.js`, five thin audits.

## How the plan changed while building

- The live run showed three rough edges, fixed before closing: placeholder text reported the same spot several times (now one row per kind with a match count); date problems were a cross-product of every pair (now one modified-before-published problem, comparing the earliest modified with the latest published date); and the "nothing shared" keyword table was clumsy (now Title / First h1 / URL path rows).
- Hidden-text detection deliberately ignores `display:none`, `<details>`, `[hidden]` and the screen-reader-only pattern (1 px with a zero clip), which are ordinary; the live run confirmed those decoys are not counted.

## Known limits

- Readability is a guide for English prose; lists, menus and technical text score oddly, and the syllable count is approximate.
- Hidden-text detection is a heuristic over the first 4,000 elements, and a same-colour check uses the nearest opaque ancestor background (a background image is not seen).
- `content-dates` reads meta tags and JSON-LD only, not a date written in the visible text.
- The main-content choice (`main`/`article`/body) can include navigation text on a page with no `main` or `article`, which affects readability.
