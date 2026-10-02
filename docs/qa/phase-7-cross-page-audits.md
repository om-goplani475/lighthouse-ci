# QA checklist: Phase 7 cross-page audits

- audits: `duplicate-titles`, `duplicate-descriptions`, `thin-content`, `canonical-conflicts`, `duplicate-content`
- merged: into `phase-7-duplicates` (ff-only), commits `2ed69ae`, `15395b6`, `c3b71b9`, `a0088f7` (plus their docs commits)
- build mode: lightweight, after a short design conversation per audit (thresholds and rules chosen with the developer)

All five read the crawl snapshot only: **no new request, no new gatherer**. Each was checked with a real Lighthouse run through
`lhci collect` and `lhci assert` against a local site with planted pages, not only unit tests.

## Functional

- [x] **`duplicate-titles` / `duplicate-descriptions`**: `/dup1` (linking to `/dup2`, same title and description) fails; `lhci assert`
      reports `duplicate-titles` as an error and `duplicate-descriptions` as a warning, each naming `/dup2`. A page with a unique
      title among 8 crawled pages passes ("Unique among 8 crawled pages").
- [x] **Reach limit shown honestly**: auditing `/dup1` when it had no links crawled only 3 pages (itself and the sitemap's two) and
      passed. A duplicate on a page the crawl did not reach is not reported; the README says so and `crawl-coverage` shows what was seen.
- [x] **`thin-content`**: a 2-word page fails with a 4% text-to-HTML ratio, listing the two other thin crawled pages; a 300-word page
      passes under `lhci assert`; the script-built page (1243 characters in a browser, 0 in the server HTML) is *not applicable*.
- [x] **`canonical-conflicts`**: a noindex audited page that two other pages canonical to fails with 3 conflicts involving it (two
      noindex targets and one "different content shares a target"); a loop between two other pages (`/c` and `/d`) is listed once and
      does not fail; `lhci assert` fails the run.
- [x] **`duplicate-content`**: three pages with identical text (`/a`, `/b/`, `/b?x=1`, 116 words) fail; the same site with the
      copies declaring a canonical to `/a` passes ("No exact duplicates among 3 compared pages").

## Rules checked with unit tests (1,307 `seo-audits` tests)

- [x] Titles/descriptions: match after trim and case-fold only (`Home | Site` is not `Home - Site`); empty values never count;
      two requested URLs ending on one final URL are one page.
- [x] Thin: 199 words fails, 200 passes; the ratio is shown and never judged; truncated or script-built audited pages are not applicable.
- [x] Canonicals: chain, loop (one row per circle), error, redirect, noindex (meta and `X-Robots-Tag`), robots-blocked and mixed-content
      targets; the audited page's *own* target is deliberately left to `indexability-conflicts`.
- [x] Duplicate content: under 50 words not compared; a page canonical to another URL is not counted; slash/query duplicates noted.
- [x] Every builder is not applicable and does not throw for a missing, disabled or unusable crawl.

## Mistakes found while checking (kept so they are not repeated)

- My first `duplicate-content` live fixture passed when it should have failed: `/dup1` had extra link text `/dup2` lacked, so the
  visible text really differed. The audit was right and the fixture wrong; rebuilt with identical text.
- The shared fixture pages hold about 55 words, so `/a` correctly reads as thin under the 200-word rule; a 300-word page was added
  for the pass case.
- `npm run test:typecheck` had an error in `crawl-thin.js` (a table row typed as number) that I missed because I read only the end of
  the output; fixed in `b63cb7b`, and the check now greps for `error TS`.

## Not verified

- The audits on real public sites (they were run against planted local pages only).
- `packages/viewer` rendering, `npm run start:seed-database` and a real GitHub Actions run (deferred by the developer until after Phase 7).
- Near-duplicate (similar but not identical) content: not built; only exact hashes are compared.
