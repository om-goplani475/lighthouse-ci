# Open items after Phase 7

Written 2026-10-02 at `main` = `28939f1` (Phases 1-7 merged, 46 audits in `seo-extended`); **updated 2026-10-05** for Phase 8 (in progress, branch `phase-8-internal-linking`; all seven items built; the phase is complete and waits for the merge into `main`). This is the one place that lists what is
**deferred**, what is **not yet verified**, and the **tests and steps to close each open item**. The per-phase detail stays in
`docs/phases/`, `docs/qa/` and `.ai-agents/state/`.

## 1. Where things stand

| Area | State |
|------|-------|
| Security findings (`.ai-agents/state/security-findings.md`) | **One open, low, accepted: Finding 10** (Phase 8: a hostile site with very long link URLs can make the crawl snapshot exceed the 16 MiB cache cap; see B1). Findings 1-9 are all fixed (8 on 2026-10-01, 9 on 2026-10-02). One risk is *accepted*, not fixed: `LHCI_SEO_ALLOW_PRIVATE_NETWORK` lets the audits reach private addresses; set it only on jobs that audit hosts you control (the README says so). |
| `seo-audits` tests | 82 suites / 1,670 tests pass on the dev machine (Node 24), typecheck and lint clean (Phase 8 complete). Also run on Node 18.20.8 (what CI pins) on 2026-10-05: all 82 suites / 1,670 tests pass (A5 done). |
| Failing suites outside `seo-audits` | 9 suites / 84 tests fail in `cli`, `server`, `viewer`, `utils` (11 / 92 after Phase 7: a few fail only intermittently under load). Same families failed before Phase 4. Not caused by this work (see C). |
| Not verified at all | Only the real-runner part of A3 (A1, A2, A4 and A5 passed on 2026-10-05; A3 was simulated locally). |

## 2. Checks still to do (these close the "Not verified" lines)

Do them in this order. Each says what to run and what "passed" means. When one passes, tick it here and delete the matching "Not
verified" line from `docs/qa/*.md` and `.ai-agents/state/security-findings.md`.

### A1. `packages/viewer` renders the new audits  (DONE 2026-10-05, passed)

**Result (run by Claude on this machine, headless Chrome):** `yarn build` passed; a full fork-config `lhci collect` of two planted pages was uploaded with `lhci upload` to a local server (`npm run start:server`); the viewer (`packages/viewer/dist`, a two-report comparison UI) and the server dashboard were driven with puppeteer. The viewer shows the "Extended SEO (fork)" category with all **73** audits (21 changed rows plus a collapsed "Unchanged (52)" group), table rows open and show their columns (`crawl-coverage`, `url-case-variants`, the image audits), and **no browser console error**. The dashboard compare page shows the same category score (its one 404 was the missing base build, as expected). Limits: the viewer only lists audits that differ between two reports, so a not-applicable row's reason text was not read in the browser; the dashboard's link to a single full report goes to Google's hosted Lighthouse viewer, which was not tested.

(Original steps, for repeating it:)

The viewer shows reports stored by an LHCI server. The 46 fork audits use table details, `notApplicable`, informational and binary
score modes, so each shape should be seen once.

1. `yarn install --frozen-lockfile && yarn build` (builds `@lhci/server` and `@lhci/viewer`).
2. Make a report with the fork config against a page that triggers findings, for example the planted-site server used in QA:
   `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1 npx lhci collect --url=http://localhost:<port>/ --settings.configPath=packages/seo-audits/src/lighthouse-config.js`
3. Start a server: `npm run start:server` (listens on `http://localhost:9009`, config `packages/cli/test/fixtures/lighthouserc.js`).
4. Upload: `npx lhci upload --target=lhci --serverBaseUrl=http://localhost:9009 --token=<project token>` (create the project with
   `npx lhci wizard`).
5. Open the build in the dashboard and the viewer. **Pass when**: the "Extended SEO (fork)" category appears, every fork audit has a
   readable row (a failing one shows its table, an informational one such as `crawl-coverage` shows its table, a not-applicable one
   shows its reason), and no row is blank or throws in the browser console.
6. Record any audit that renders badly in `.ai-agents/state/ci-backlog.md`; a rendering bug is a `fix(seo-audits)` commit.

### A2. `npm run start:seed-database`  (DONE 2026-10-05, passed)

**Result:** with `npm run start:server` running, `npm run start:seed-database` exited 0 and `/v1/projects` listed the seeded projects ("Lighthouse Dashboard", "Lighthouse Viewer"). The `--load` stress dataset was not run.

(Original steps:)

1. In one terminal: `npm run start:server`.
2. In another: `npm run start:seed-database` (writes the default dataset to the server at `http://localhost:9009`).
3. **Pass when**: it exits 0 and the dashboard lists the seeded project and builds. This checks that the fork's additions did not
   break the stock server and database path. (Add `--load` for the larger load-test dataset if you want the stress case.)

### A3. A real GitHub Actions run with the fork config  (PARTLY DONE 2026-10-05: simulated locally; the real run is still yours)

**Simulated by Claude on this machine** (not a GitHub runner, so the real run is still open): `yarn install --frozen-lockfile` succeeded and left `yarn.lock` byte-identical; `npm i -g @lhci/cli@0.15` gave 0.15.1 with **its own `lighthouse` 12.6.1 copy, separate from the repo's**, and `lhci collect` from it with the fork config worked: all 73 fork audits present, no "audit not found", on three URLs; `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` reached the child Lighthouse processes (`crawl-coverage` "Crawled 7 of 50 pages"); a request-logging site saw each crawled page **once** across 3 URLs (robots.txt twice: crawler and sitemap gatherer); the cache directory is mode 700; and the same collect under Node 18.20.8 with a cold cache worked on the fork's own CLI. Note: `lhci autorun` with no `assert` block falls back to the stock `lighthouse:recommended` preset and fails on its performance assertions, so a real workflow needs its own `assert` section.

**Still needs a real run:** the runner's egress/DNS, a real shared runner's temp directory, the actual `.github/workflows` of your project, and the cost and time of a cold crawl on a real site.

(Original steps:)

Three open points from earlier: the global `@lhci/cli@0.15.x`, `npm install` against this repo's `yarn.lock`, and a possible
two-Lighthouse-copies problem.

1. Pick a throwaway branch and a small public site, or a local site served inside the job.
2. In the job, install the way you would for real: either the global `npm i -g @lhci/cli@0.15.x`, or a checkout of this fork followed
   by `yarn install --frozen-lockfile`. Run it **both ways** and compare.
3. Point `.lighthouserc.js` at the fork config: `collect.settings.configPath: require.resolve('@lhci/seo-audits/lighthouse-config.js')`.
   Add the assertions you want (none of the 46 are in the shared presets).
4. Run `lhci autorun` (it fails on a collect error; a separate `lhci assert` after a failed `collect` passes silently, see
   `.ai-agents/state/ci-backlog.md`).
5. **Check each of these**, they are the actual risks:
   - **Two Lighthouse copies**: in the job, `npm ls lighthouse` (or `yarn why lighthouse`). The fork pins `lighthouse@12.6.1`; a global
     `@lhci/cli` brings its own. Two versions in one run is the thing to rule out: the fork's audits extend one copy's `Audit` class.
     **Pass when** the fork audits appear in the report (the "Extended SEO (fork)" category exists) with no "audit not found" error.
   - **`yarn.lock`**: `yarn install --frozen-lockfile` must succeed unchanged (it did locally for Phase 7: `htmlparser2` is already in the lock).
   - **Environment variables** reach the child Lighthouse processes: set `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` for a localhost target and
     confirm `crawl-coverage` is not "not applicable".
   - **Crawl cost and time**: the first run crawls (up to ~100 requests, up to 120 s). With several URLs in one `collect`, check the
     site's log shows each crawled page requested **once** (the cache is under the runner's temp dir, `lhci-seo-crawl-<uid>`).
   - **Shared runner**: the cache directory must be created with mode 0700 on a shared runner; if the run warns that the cache is
     unusable, the crawl still works but each run crawls again.
   - **Node 18**: the workflow pins Node 18 (`.github/workflows/ci.yml`). The job must be green there, not only on Node 24.
6. **Pass when** the run is green, the report shows the fork's audits and each crawled page was requested once.

### A4. Look up `htmlparser2@6.1.0` in a vulnerability database  (DONE 2026-10-05, passed)

**Result:** `yarn audit --groups dependencies` reports no advisory for `htmlparser2` (only 6.1.0 is installed), `saxes`, `parse5`, `robots-parser` or their sub-dependencies (`domhandler`, `domutils`, `entities`, `domelementtype`). The 156 advisories it does report (4 critical: `sequelize` under `@lhci/server`, `basic-ftp` under `lighthouse`/`puppeteer-core` and `@lhci/cli` proxy-agent) are upstream packages the fork does not touch and the crawler does not use. Worth knowing, not part of this check.

I could not do this from the session (no lookup available). Run `yarn audit --groups dependencies` (or `npm audit`) and check
`htmlparser2` and its dependencies. The exposure is already bounded (512 KiB body cap, measured 53 ms worst case, extraction only), so
a finding here would most likely be informational. **Pass when** nothing high or critical is reported for the packages the crawler uses
(`htmlparser2`, `saxes`, `parse5`, `robots-parser`); anything else goes into `security-findings.md`.

### A5. Re-run the Phase 7 and Phase 8 suites under Node 18.20.8  (DONE 2026-10-05, passed)

**Result:** `jest packages/seo-audits` under Node v18.20.8: 82 suites / 1,670 tests pass, including `closeAllConnections()` and the crawler integration test. (Typecheck and lint are Node-independent and were not re-run.)

CI pins Node 18. The Phase 5, Phase 6 and Phase 7 crawler suites were run there; the five Phase 7 audits, the `safeFetchBytes` change and all of
Phase 8 (so far the crawler extension) were not. `nvm use 18 && npx jest packages/seo-audits`. **Pass when** all 75 suites pass. The risky spots are
`server.closeAllConnections()` (Node 18.2+) and the crawler's integration test, which waits for a real 10 s budget.

### A6. Spot-check the new audits (Phases 7 and 9) on a few real sites (optional)

They were run against planted local pages only. Run `lhci collect` with the fork config on two or three real sites and read the
tables once. Also look at the Phase 14 content audits (`placeholder-content` on a page about templates, `hidden-text` on CSS effects, readability numbers on real prose), the Phase 11 hreflang audits (a real multi-domain site, and one whose hreflang is only in the sitemap), the Phase 12 rendering audits (a real Next.js/React/Angular site for `rendering-mode` and `hydration-errors`; a site that serves mobile differently for `device-content-parity`), the Phase 10 image audits (alt heuristics, `image-oversized`) and the Phase 9 URL audits (`url-length` at 115 characters on long-slug blogs; `url-normalization` groups). Look for false positives: a script-built site that is wrongly judged thin or duplicate (it should say "not applicable"),
or a site that serves bots a different page. Anything wrong is a `fix(seo-audits)` commit with a test.

### B. Opened by Phase 8 (updated as the phase proceeds)

**B1. Close Finding 10 (low, open, accepted): the crawl snapshot can exceed the cache cap on a hostile site.**
Item 0 stores each page's links with their URLs (up to 2,000 characters each) and anchor text. At the default 50 pages the worst case is a 20 MiB snapshot
(about 360 MB resident, 1.5 s); at 200 pages, 81 MiB (about 750 MB). The cache refuses a file over 16 MiB, so each Lighthouse run then crawls again.
1. Decide whether it matters for your sites: it needs a site whose pages carry hundreds of near-2,000-character link URLs. Real sites do not.
2. To close it: give the snapshot a byte budget for stored links (or a lower URL length for stored links), on a `fix/...` branch, with a test that a hostile
   site's snapshot stays under the cache cap. The reproduction is in `docs/qa/link-graph-crawler.md` (a server whose pages each link to 250 pages with
   1,900-character URLs; run the crawler at `LHCI_SEO_CRAWL_MAX_PAGES=200`).
3. **Pass when** that reproduction produces a snapshot under 16 MiB and the cache write succeeds. Then mark Finding 10 fixed in `security-findings.md` and the
   `ci-backlog.md` entry done.

**B2. Extra things to look at in the real GitHub Actions run (A3), because of the deeper crawl.**
The crawl now follows links 3 hops and starts from the homepage: a cold crawl is up to about 150 requests and may spend the full 120 s on a big site. In the
real run, check how long the first Lighthouse run takes with the crawl on, and that the page cap (50) or the time budget is what ends it (the `crawl-coverage`
table notes say which). If it is too slow for CI, lower `LHCI_SEO_CRAWL_MAX_PAGES` or `LHCI_SEO_CRAWL_MAX_DEPTH`, or set `LHCI_SEO_CRAWL=0`.

**B3. Viewer (A1) will also need to show `crawl-coverage`'s new Depth column and the four link-graph audits' tables** (page, inbound/outbound or depth columns,
notes). No action beyond A1.

**B5. The link-check audits send extra requests, per run: look at it in the real GitHub Actions run (A3).** Every Lighthouse run status-checks up to 100 of the audited page's own
links that the crawl did not read (up to about 300 requests, up to 30 s). With `numberOfRuns` of 3 that repeats three times, because it is per run and not cached. In the real run, check
how much time and how many requests that adds and whether the audited site's logs tolerate it. If not: `LHCI_SEO_CRAWL_MAX_LINK_CHECKS=25`, or `0` (the audits then judge only links to pages the
crawl read and say how many targets they could not check). A possible follow-up, not built: cache the link checks per audited URL like the crawl.

**B6. `pagination-trap` needs a deeper crawl to catch a next-only endless chain.** At the default depth (3) such a chain is reported as "too few to call it a trap". With
`LHCI_SEO_CRAWL_MAX_DEPTH=5` the same series fails. Decide whether to raise the depth for sites with long listings (a longer crawl), or accept the limit. A site that shows many page
numbers at once is caught at the default depth. A `rel=next` loop longer than 50 pages is also not detected.

**B7. The external link checks send requests to other people's sites: verify them in the real GitHub Actions run (A3), and decide the defaults.** Every run checks up to 20 of the audited page's external
links (2 per host, 15 s, status only, no third-party robots.txt). Steps: (1) in the real run, check how long the audit adds and that a runner without outbound access degrades to "unreliable" and
never to false "broken" links (only a 404, 410, a missing host or a refused connection fails); (2) look at the audited site's own logs and a third party's if you have one, for the
`lhci-seo-audits-crawler/1.0` user-agent; (3) decide whether on-by-default is right for your team: `LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS=0` switches it off, `5` makes it very light. **Pass when**
a run on a site with a known dead external link fails the audit and a run with the setting at 0 reports the audit as not applicable. Not verified: behaviour against many real third-party sites
(rate limiters, tarpits, odd redirects); only `example.com` and made-up hosts were used.

**B4. `orphan-pages` is usually not applicable with the default crawl limits.** It is only judged when the crawl saw the whole site (no page cap, depth bound or
time budget cut it), so on a site of more than about 50 pages it says "not applicable" and names the limit. To use it on a bigger site, raise
`LHCI_SEO_CRAWL_MAX_PAGES` (up to 200) and `LHCI_SEO_CRAWL_MAX_DEPTH` (up to 5) and accept the longer crawl; check in the real GitHub Actions run (A3) whether that is affordable.
There is no way to judge orphans on a site larger than 200 pages with this crawler; if you need that, it is a new decision (a dedicated crawl command, or sitemap-only
orphan detection).

## 3. Deferred features (choices, not bugs)

Grouped by what unblocks them. Phase numbers are the fork's own phases (`docs/phases/`).

### Unblocked by Phase 8 (link-following beyond depth 1, the link graph)

Phase 8 is built: the crawler follows links to depth 3 and the audits that use it exist (see `docs/phases/phase-8-internal-linking.md`). **Closed by item 3**: internal URLs returning 4xx/5xx, internal links that redirect, redirect chains and loops on internal links (the three Phase 5 deferrals). The rows below are what is **still** deferred; none was needed by Phase 8.

| Item | From | Note |
|------|------|------|
| Internal URLs returning 4xx/5xx | Phase 5 | needs each page's links requested; the snapshot already stores them |
| Internal links that redirect instead of resolving | Phase 5 | same |
| Redirect chains and loops on internal links | Phase 5 | Phase 5 covers only the audited URL's host variants |
| Soft-404 content heuristics ("not found" wording on a 200 page) | Phase 5 | needs many pages |
| Per-URL indexability decision tree across the whole site | Phase 6 | Phase 6 judges the audited page and its canonical target |
| Canonical target on a different origin | Phase 6 | recorded, never requested (one request per audited page is the bound) |
| Check every sitemap URL, every child sitemap | Phase 4 | currently a bounded sample (10, max 25) and the first 10 sitemap files |

### Needs new infrastructure or a bigger decision

| Item | From | Note |
|------|------|------|
| Near-duplicate content (similarity / shingling) | Phase 7 | exact hashes only today; similarity is its own false-positive decision |
| Inconsistent URL representations resolving to one page, site-wide | Phase 7 | `url-variant-consistency` covers one URL |
| A separate `seo-crawl` command writing the snapshot ahead of `lhci collect` | Phase 7 | only if the in-run crawl time becomes a problem |
| Noindex or canonical injected by JavaScript | Phases 4, 6 | needs a browser render per URL (JavaScript rendering parity) |
| Following redirects for a sitemap URL | Phase 4 | needs a re-validating redirect mode in `safe-fetch.js` (a security-reviewed path) |
| Sitemap image/video/news/`xhtml:link` extensions, text/RSS/Atom sitemaps, nested indexes | Phase 4 | tolerated, never reported invalid |
| `llms.txt` link reachability, `llms-full.txt`, `llms.txt` at a subpath | Phase 4 | |
| HTTP `Link` header canonicals | Phases 4, 6 | core's `canonical` audit covers headers |
| Microdata / RDFa; cross-checking structured data against visible content | Phase 2 | |
| Auto-detecting Google doc changes; LLM rule extraction | Phase 2 | intended, sequenced after real usage |
| `robots.txt` wildcard/`$` overlap detection | Phase 4 | exact-match only today |
| Fuzzy / semantic matching (title similarity, H1 relevance, generic titles) | Phase 1 | heuristics are literal today |
| Fetching the canonical to confirm it resolves; numeric `og:image` thresholds | Phases 1, 3 | |

### Not possible, by policy or physics

Exact parity with Google's Rich Results Test; a true visual social-card render inside Lighthouse's report; autonomous publishing of
ruleset changes without human review. Details in `docs/phases/phase-2-structured-data.md` and `phase-3-social-metadata.md`.

## 4. Housekeeping found while writing this

- **`docs/phases/phase-1-page-metadata.md` is stale.** Its "Not possible without new infrastructure" table still lists duplicate
  titles and duplicate meta descriptions as impossible; Phase 7 built them (`duplicate-titles`, `duplicate-descriptions`). Move those rows
  to done. The same file calls roadmap Phase 16 "Site Intelligence & Multi-page Crawler", while `docs/master-roadmap.md` titles it
  "Site Intelligence / Product Layer": align the two, and drop the "Phase 16/31" reference now that the crawler exists.
- **A pinned behaviour to remember**: `sitemap-url-status` scores 1 when its time budget runs out before the sample finishes.
- **Failing suites outside `seo-audits`** (11 now): run the same suites on a clean checkout of upstream `main` once; they are Storybook,
  Puppeteer and e2e suites in `server` and `viewer`, plus `cli/test/autorun-github.test.js`, `cli/test/upload.test.js`,
  `cli/test/wizard.test.js` and `utils/test/build-context.test.js` (the causes were not investigated). Not caused by this work (compared against the pre-Phase-4 base, 2026-10-01) but never fixed; they only matter if
  you want a fully green local `npm run test`.

### E. Phase 13: verify `core-web-vitals-field` with a real key (needs you)

The audit was built and run live without a key (not applicable), with a key on localhost (nothing sent) and against the real Google endpoint with a fake key (a clear 400), but **the success path has never seen real data**. **Steps:** create a Google Cloud API key and enable the "Chrome UX Report API" (free); then `LHCI_SEO_CRUX_API_KEY=<key> npx lhci collect --url=<a busy public site, for example https://web.dev/> --settings.configPath=packages/seo-audits/src/lighthouse-config.js` and read the `core-web-vitals-field` table. **Pass when** it shows LCP, INP and CLS values with a Google rating and a collection period, says whether the URL or the whole site answered, and the key does not appear in the report JSON. A site with too little traffic returns "no data", which is expected. Anything off is a `fix(seo-audits)` commit with a test using the real response shape.

## 5. How to close an item

1. Do the steps; if it passes, tick it above and delete its "Not verified" line elsewhere.
2. If it finds a problem, add an entry to `.ai-agents/state/security-findings.md` (a risk) or `.ai-agents/state/ci-backlog.md` (a gap),
   fix it on its own `fix/...` branch with a test, and mark the entry fixed or done.
3. Re-run `npm run test:quick`, and keep the `seo-audits` suites green.
