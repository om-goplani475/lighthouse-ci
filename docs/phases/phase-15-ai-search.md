# Phase 15 — Emerging / Forward-Looking (AI search / AEO / GEO)

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-15-ai-search` (off `main`).

**Status: Done (2026-10-05), merged into `main`.** Everything is informational by decision.

## Planning decisions (2026-10-05, lightweight with a plain-language design conversation)

1. **Build all four reports**: an answer-friendly structure report, an author and entity report, an AI-crawler summary, and an AMP check.
2. **Nothing fails a build.** There is no Google or industry rule to fail against for this area, and the 2026-10-05 review found the fork already fails too much. All four are informational and say so.
3. **`llms-txt-structure` is left unchanged for the calibration pass** (it is already on the review's list of audits to make informational); the new reports only read whether the file exists.

## Features

| Roadmap row | Status | Audit |
|---|---|---|
| GPTBot / ClaudeBot / PerplexityBot access auditing | **done** (extended) | `ai-crawler-summary` (15 crawlers and tokens); Phase 4's `robots-txt-crawler-access` still shows four |
| AI-Overview/LLM-citability readiness; content extractability | **done** | `answer-structure` |
| Entity clarity, author/entity attribution, factual consistency | **done** (descriptive) | `author-entity-signals` (the "factual consistency" part is limited to the site name being the same in JSON-LD and `og:site_name`) |
| AMP validity (low priority) | **done** (informational) | `amp-check` |

Code: `lib/ai-crawlers.js`, `lib/ai-structure.js`, `lib/ai-entities.js`, `lib/ai-amp.js`, gatherers `content-structure.js` and `amp-page.js`, four thin audits.

## How the plan changed while building

- The AMP gatherer **reuses** `checkAlternates` from the hreflang work (one alternate, the same safe-fetch policy and bounds) instead of a new fetcher.
- The AI-crawler report is a separate small module rather than an extension of the Phase 4 simulator, which is tied to its fixed list and to the scored search-engine rows.
- A prettier line-split broke the `@ts-expect-error` that covered the long artifact list of `answer-structure`; that audit now casts its `requiredArtifacts` instead.

## Known limits

- **"Factual consistency" is not attempted** beyond the site name: there is no reliable way to check facts from the page alone.
- The crawler list follows vendors' public names as known at the time; some (for example `Claude-User`, `Claude-SearchBot`) should be verified against the vendors' current documentation.
- Question headings are those ending in `?` among `h2`-`h4`; the "answer" is only the element right after the heading.
- `ai-crawler-summary` reads robots.txt only; it does not see an `X-Robots-Tag` or meta tag aimed at AI, or a CDN or firewall rule that blocks a crawler.
