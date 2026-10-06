# Phase 12 — JavaScript SEO / Rendering Parity

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-12-js-rendering` (off `main`), the tenth phase to use the phase-branch workflow. Phase 11 (hreflang) was skipped for now at the developer's request. Merges into `main` once built, QA'd and approved.

**Status: done (2026-10-05): built, QA'd live and merged into `main`; recalibrated on 2026-10-06 (`js-head-signals` fails only on a changed noindex or conflicting canonicals; `js-internal-links` and `js-visible-content` are warnings).**

## Planning decisions (2026-10-05, lightweight with a design conversation)

1. **Raw vs rendered**: compare Chrome's raw HTML (Lighthouse `MainDocumentContent`) with the DOM after load; **and** note when the crawler's own copy of the page differs (the "both" choice).
2. **Rows**: all four groups: head signals only after JS, links and content only after JS, SSR/CSR + hydration hints, mobile vs desktop parity.
3. **Strictness**: head signals fail; links (over 20% and at least 3) and content (over half the words) fail past a share, otherwise a note.
4. **Excessive DOM size**: left to Lighthouse core `dom-size` (stated, not asked).

Choices I made and stated: both sides are read with the existing crawler extractor (so a difference is a difference in the HTML); device parity uses ordinary browser user-agents with an `lhci-seo-audits/1.0` token rather than impersonating Googlebot; and it can be switched off (`LHCI_SEO_DEVICE_PARITY=0`).

## Features

| Roadmap row | Status | Audit |
|---|---|---|
| Raw HTML vs rendered DOM diff (general) | **done** | `raw-rendered-diff` (informational) |
| Title/meta description/canonical/robots only created after JS | **done** | `js-head-signals` |
| Important internal links only appearing after JS | **done** | `js-internal-links` |
| Important visible content unavailable in initial HTML | **done** | `js-visible-content` |
| Excessive DOM size | **covered by core** | Lighthouse `dom-size` |
| Mobile vs desktop content/link parity | **done** | `device-content-parity` (server HTML only) |
| SSR vs CSR detection, hydration issues | **done** | `rendering-mode` (informational heuristic), `hydration-errors` |

Code: `lib/rendering.js` (all builders), gatherers `rendered-html.js` and `device-fetches.js`, seven thin audits.

## Known limits

- `device-content-parity` sees the server's answer to two user-agents, not CSS or JavaScript differences between viewports, and not a site that cloaks by IP or by a verified Googlebot.
- A page that changes its title after a route change (a single-page app) is reported as it is at the end of load.
- `rendering-mode` is a word-count heuristic: a page that renders an excerpt on the server and the rest later is "hybrid".
- Single page only; the crawl is not rendered.
- The audited page is requested two more times per run (`device-content-parity`).
