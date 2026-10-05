# QA checklist: Internal link-check audits (Phase 8 item 3)

- audits: `broken-internal-links`, `redirecting-internal-links`, `internal-redirect-chains`
- build mode: lightweight, after a design conversation; new per-run data `linkChecks` on the crawl artifact
- branch: `feat/link-check-audits`, off `phase-8-internal-linking`

Verified with real Lighthouse and `lhci collect`/`lhci assert` runs against a planted site (a home page with 7 special links and 121 filler links, so the
50-page crawl leaves most of them unread), and against hostile servers over the real fetch path.

## Functional

- [x] **Live Lighthouse run** (audited `/`): `broken-internal-links` fails with 3 broken links: `/gone` (404), `/err` (500) and `/late-broken` (404), the last one
      **never crawled** (position 80 of the page's links): found by the status check. `redirecting-internal-links` fails on `/old` (301 to `/ok`) and lists `/tmp`
      (302 to `/ok`) as "temporary redirect, not failing". `internal-redirect-chains` fails on `/chain1` (2 hops, `301 > 301`, to `/chain3`) and `/loop1`
      ("loop after 4 hops").
- [x] **`lhci collect` (2 runs) then `lhci assert`**: the error-level assertions fail the run, the warn-level one warns, exit status 1.
- [x] **Request cost**: `/late-broken` was requested once per run (twice for two runs: the status check is per run, by design); pages the crawl read were requested once.
- [x] **Unit tests**: 78 suites / 1,500+ tests; the new builders (52), the link-check behaviour in `crawler.test.js` (13 new), and `crawl-coverage` (the new note).

## Safety, run against hostile servers (real fetch path)

- [x] **Another origin is never requested**: two links that redirect to a spy server on another port: the spy received **0** requests (the redirect is recorded and
      not followed).
- [x] **robots.txt**: a link to a disallowed path is recorded as "blocked-by-robots" and not requested (0 requests); an unreadable robots.txt means no checks and no claims.
- [x] **Bounds**: 200 targets of which 60 hang forever, 60 redirect forever and 60 return 5 MiB bodies: the whole run ended at the **30 s** link-check budget; only 15
      hang requests were made, 164 targets counted as "not checked", total 40 requests to the site (cap 3 per target); bodies are read at most 2 KiB.
- [x] **Redirect loops** among checked links stop within the redirect rounds and show as a repeated URL (a loop), never an endless chain.

## Findings (all fixed, each with a test)

1. A redirect into an already-requested destination left the entry on the 3xx: wrong destination shown (`302 to /tmp`) and a broken destination invisible.
2. Two checked links redirecting to the same place: the second stopped at the redirect (shared "already requested" set); each is now followed to its end.
3. **A crawler bug since item 0** (found by the hostile run): URLs the time budget stopped the crawler from requesting were recorded as pages that "did not answer".
   They would have been reported as broken links; they are now skipped entries ("not checked").

## Not verified

- A real public site; the viewer; a real GitHub Actions run (the status checks add up to about 300 requests per Lighthouse run); the Node 18.20.8 re-run.
