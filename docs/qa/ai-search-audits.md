# QA — AI search and answer-engine reports (Phase 15)

`ai-crawler-summary`, `answer-structure`, `author-entity-signals`, `amp-check` (all informational).

## Verified (2026-10-05)

- [x] Unit tests: `test/lib/ai-crawlers.test.js` (absent robots.txt, a named block, a wildcard block, case-insensitive names, unique list), `ai-structure.test.js` (the text-in-HTML measure, skipped heading levels, Q&A types), `ai-entities.test.js` (author and publisher forms, bad sameAs, a differing site name, malformed input, the row cap), `ai-amp.test.js` (an AMP version that loads, 404, redirect, noindex, wrong canonical, an AMP page itself, switched off, the gatherer's one request), `test/gatherers/content-structure.test.js`, config tests. `seo-audits`: 111 suites / 1,949 tests, typecheck and lint clean.
- [x] Live `lhci collect` with the fork config against a planted site (port 9525, with a robots.txt that blocks GPTBot and ClaudeBot, an `llms.txt` and an AMP version):

  | Page | Result |
  |---|---|
  | `/article` (landmarks, three question headings, a FAQPage block, an Organization with sameAs, an `og:site_name` differing from the JSON-LD name, a `rel=amphtml` link) | the crawler summary showed 13 of 15 allowed (GPTBot blocked by its own rule, ClaudeBot blocked on this path); the structure report found the text fully in the HTML, 3 question headings with 2 short answers, 1 skipped heading level, FAQPage and `llms.txt` present; the entity report found three author signals, the publisher, one valid and one invalid sameAs link, a declared logo, and the differing site name; the AMP report found the version answers 200 and names the page as its canonical |
  | `/csr` (an empty root filled by JavaScript, no landmarks) | the structure report said "little (0% of the words are in the HTML)", no landmarks, no questions; the entity report found no signals; AMP not applicable |

## Not verified

- A real AMP site, and a cross-origin AMP URL at a private address (the safe-fetch policy is shared with the hreflang requests, which were proven with a spy server; not repeated here).
- Real sites (A6): whether the question-heading heuristic and the 60-word "short answer" are sensible on real content.
- The crawler names against the vendors' current documentation.
- `packages/viewer` rendering of these tables.
