# QA: Robots.txt & Sitemap (Phase 4)

Grows as items land; each section is verified against a real `lhci collect` run, not just Jest.

## Item 1: `robots-txt-sitemap-declared`

No new gatherer: reads Lighthouse core's own `RobotsTxt` artifact (`{status, content}`), parsed by
`src/lib/robots-txt.js`.

Unit tests: 3 parser cases + `robotsTxtState` table + 6 audit cases (declared, one-valid-of-many,
no Sitemap line, all-relative/non-http values, 404, 5xx/fetch failure). Typecheck, lint and the
full seo-audits suite pass.

### Verified live (real `lhci collect`, `--settings.configPath` = this package's config)

Three local sites served with `python3 -m http.server`, differing only in `/robots.txt`:

- [x] robots.txt with `Sitemap: https://example.com/sitemap.xml`: `score: 1`.
- [x] robots.txt without any `Sitemap:` line: `score: 0`, explanation "robots.txt has no
      `Sitemap:` line."
- [x] no robots.txt (404): `score: 0`, explanation "No robots.txt was found, so no sitemap is
      declared."
- [x] audit present in the `seo-extended` category in all three runs.

Not exercised live: the `notApplicable` branch (5xx / fetch failure) — covered by unit tests only.

Note: the sitemap URL is not fetched, so a declared-but-dead sitemap still passes here by design;
validity and reachability are items 4-5.

## Item 2: `robots-txt-crawler-access`

Covers roadmap items "per-UA rule simulation", "important pages accidentally blocked" and
"CSS/JS accidentally blocked" in one audit. Reads core's `RobotsTxt` artifact plus
`NetworkRecords` (to learn which same-origin CSS/JS the page actually loaded). Adds
`robots-parser@^3.0.1` to `packages/seo-audits/package.json`; it is already a Lighthouse
dependency, so `yarn.lock` and the installed version (3.0.1) are unchanged.

Scored on Googlebot and Bingbot only (page blocked, or any same-origin CSS/JS blocked). Googlebot-
Image and the AI crawlers (GPTBot, ClaudeBot, CCBot, PerplexityBot) appear in the table but never
fail the audit. Cross-origin CSS/JS is skipped, since robots.txt only governs its own origin.

Unit tests (11 cases in `test/lib/robots-access.test.js`): permissive file, page blocked, AI
crawler blocked but not scored, blocked CSS/JS listed, cross-origin/image/data: URLs ignored,
specific group beats `*`, Googlebot-Image fallback to the `googlebot` group and its override by an
explicit group, URL list cap, result shape.

### Verified live (real `lhci collect`)

Three local sites, each serving a page that loads `/assets/site.css` and `/assets/app.js`:

- [x] `Disallow: /assets/` for `*` plus `GPTBot: Disallow: /`: `score: 0`, "Googlebot is blocked
      from 2 CSS/JS file(s); Bingbot is blocked from 2 CSS/JS file(s)". Page shown Allowed for
      both, GPTBot shown Blocked but not in the explanation.
- [x] `Disallow:` (permissive): `score: 1`, all seven rows Allowed / None blocked.
- [x] `Googlebot: Disallow: /` only: `score: 0`, "Googlebot is blocked from this page; Googlebot is
      blocked from 2 CSS/JS file(s)"; Bingbot Allowed. Googlebot-Image shown Blocked via the
      fallback to the `googlebot` group (confirms that behavior live, not just in Jest).

Not exercised live: the `notApplicable` (robots.txt 5xx) and absent-robots.txt (score 1) branches —
unit-covered at the `robotsTxtState` level only.

Known limitation: the "Same-origin CSS/JS" column is filled for every crawler, including AI
crawlers and Googlebot-Image, for which rendering assets are not really the point; it is accurate
but only meaningful for the two scored search engines.

## Item 3: `robots-txt-rule-conflicts`

Reads core's `RobotsTxt` artifact only. `findRuleConflicts` in `src/lib/robots-txt.js` merges groups
naming the same user-agent (crawlers combine them), then flags any path string that is both Allow
and Disallow. Scored pass/fail; the failure carries a table of user-agent, path, and the two line
numbers.

Deliberately not flagged: an Allow and Disallow of *different* paths (ordinary longest-match
precedence), the same rule repeated, an empty `Disallow:` (means allow-all, no path to contradict),
and the same path under different user-agents. Only identical path strings are compared, so
wildcard overlaps (`/a*` vs `/ab`) are not detected. Google resolves a same-path tie in favor of
Allow; other crawlers may differ, which the audit description says.

Unit tests: 8 audit cases (clean, single-group conflict, split-across-groups, shared group reports
each agent, different agents, different paths/empty Disallow, duplicate same-type rule,
absent/unavailable).

### Verified live (real `lhci collect`)

- [x] `Disallow: /shop` + `Allow: /shop` under `*`: `score: 0`, one row (`*`, `/shop`, lines
      "3 / 2").
- [x] `googlebot` group with `Disallow: /a`, a separate `*` group, then a second `googlebot` group
      with `Allow: /a`: `score: 0`, one row (`googlebot`, `/a`, "8 / 2") — the split-group case.
- [x] `Disallow: /private` + `Allow: /private/public`: `score: 1`, no details.
- [x] audit present in the `seo-extended` category in all three runs.

Not exercised live: absent (score 1) and unavailable (`notApplicable`) branches — unit-covered.
