# QA — rendering audits (Phase 12)

Seven audits: `js-head-signals`, `js-internal-links`, `js-visible-content`, `raw-rendered-diff`, `rendering-mode`, `hydration-errors`, `device-content-parity`.

## Verified (2026-10-05)

- [x] Unit tests: `test/lib/rendering.test.js` (each rule at its boundary, applicability, odd input, the row cap, a 500,000-repetition console message), `test/gatherers/device-fetches.test.js` (the bounds, the user-agents, failures as data, the off switch and the non-http guard), `test/gatherers/rendered-html.test.js`, config tests. `seo-audits`: 89 suites / 1,759 tests, typecheck and lint clean.
- [x] Live `lhci collect` with the fork config against a planted site (port 9520):

  | Page | Result |
  |---|---|
  | `/ssr` (all content in the HTML) | everything passes; mode "server-rendered"; 0 of 7 measures differ |
  | `/csr` (empty root, JS builds title, description, canonical, h1, 150 words and 10 links) | head signals fail (3 rows), links fail (10 of 10), content fails (100%); mode "client-rendered" with "an empty root element"; diff shows 6 of 7 differ |
  | `/hydrate` (console error "Text content does not match server-rendered HTML") | `hydration-errors` fails with the message; the rest pass |
  | `/cloak` (a different title, half the links and fewer words for a Mobile user-agent) | `device-content-parity` fails with title, links (50%) and words (84% fewer); the diff notes the crawler's copy differs from Chrome's |
  | `/cloak` with `LHCI_SEO_DEVICE_PARITY=0` | not applicable, with the switch named |

## Not verified

- Real single-page-app frameworks (Next.js, Nuxt, Angular, React hydration warnings); only planted pages and unit messages were used.
- A site that cloaks by IP address or a verified Googlebot.
- `packages/viewer` rendering of these tables (A1 covered the existing audits).
