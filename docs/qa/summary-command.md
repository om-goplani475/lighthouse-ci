# QA: the `seo-summary` command (Phase 16)

## Automated

32 unit tests in `packages/seo-audits/test/summary/` (scoring weights, partial scores, not-applicable handling, ranking, comparison, rendering and escaping, and the command run as a child process: markdown, JSON, `--compare`, `--out`, a folder with a bad file, usage errors).
A test also keeps `categories.js` in step with the audits in `lighthouse-config.js`.

## Live (2026-10-06)

- [x] Two real `lhci collect` runs of a planted site (a page changed between them), then `summary/cli.js .lighthouseci --compare <first run>`: the per-page table, the category table, the ranked issues (error tier first), the guidance and the comparison all rendered; the planted fix showed as "Fixed" and the two things the change broke as "New issues"; an unchanged page showed 0.0 change and no new or fixed issues.
- [x] Found and fixed in QA: an audit with no display text (`open-graph-completeness`) left "What it found" blank, so the first table row is now used.
- [x] Used in the A3 workflow summary (`.github/workflows/seo-audit.yml`).

## Not verified

- Output on a large multi-page crawl (50 pages x 3 runs): the per-URL summary keeps only the latest run of each page, and only a handful of pages were tried.
- How the markdown looks in the GitHub step summary (the A3 run will show it).
