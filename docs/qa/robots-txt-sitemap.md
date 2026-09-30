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
