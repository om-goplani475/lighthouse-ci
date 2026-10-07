# Open items

Reconciled 2026-10-07 at `main` = `7ce76db`: Phases 1 to 18 are built and merged (Phase 19 is in progress on its own branch). This file lists only what is **still open**: checks not yet
done, decisions waiting, and deferred features. What was finished is in `docs/phases/`, `docs/qa/`, `.ai-agents/state/changelog-draft.md`,
`.ai-agents/state/security-findings.md` and `docs/seo-audits-phase-0-to-15-review.md` (the review of Phases 0 to 15, kept as a historical record).

## 1. Where things stand

| Area | State |
|------|-------|
| Webhook platform | Phase 17 (`packages/server/src/seo/`, `packages/seo-audits/src/service/`, the dashboard): built and QA'd live; see the README and `docs/qa/webhook-platform.md`. |
| Summary command | `packages/seo-audits/src/summary/cli.js` (Phase 16) scores, ranks and compares the reports; see the README. |
| Audits | 125 in the `seo-extended` category (Phase 18 merged 2026-10-07), from 18 gatherers: 79 scored (31 error tier, 48 warn tier) and 46 informational. `packages/seo-audits/src/recommended-assertions.json` asserts the scored ones. |
| Tests | The `seo-audits` suites (138 suites / 2,439 tests) pass on Node 24 and on Node 18.20.8 (what CI pins), checked 2026-10-06; a full-repository run on 2026-10-07 had only the known failures below plus two load timeouts that pass alone. Typecheck and lint clean. |
| Security findings | **None open.** Findings 1-10 are fixed. One risk is *accepted*, not fixed: `LHCI_SEO_ALLOW_PRIVATE_NETWORK` lets the audits reach private addresses; set it only on jobs that audit hosts you control (the README says so). |
| Viewer | `@lhci/viewer` renders all 34 audits that had tables in five real reports (2026-10-06); the server and `seed-database` path was checked on 2026-10-05. |
| Not built yet | Phase 19 (in progress): SARIF, reporting and history, SERP preview, template detection (secrets at rest is built). Phase 20: scheduled monitoring and the GitHub App. AI-generated fixes are not planned. See `docs/phases/phase-19-reporting-and-hardening.md`. |
| Failing suites outside `seo-audits` | 6 screenshot suites in `server` and `viewer` fail on this machine only (see section 4); the rest pass. Not caused by this work. |
| Not verified at all | The CrUX success path with a real key (E). A real pull request comment, Slack and Teams alert and GitHub/GitLab webhook delivery (H). The workflow after the 2026-10-07 change (actions v7, runner `ubuntu-24.04`) has not run on GitHub yet (A3). |

## 2. Checks still to do

### A3. Re-run the GitHub Actions workflow after the 2026-10-07 change (needs you)

The first real run (2026-10-06, `https://web.dev/`) passed every check: the fork's `lhci` and the global `@lhci/cli` gave identical reports (0 differences), 57 of 57 scored audits ran then, the whole run took 71 s. Since then the workflow moved its actions to v7 and pinned the runner to `ubuntu-24.04`. **Run "SEO audit (A3 check)" once more** after pushing `main`: it should pass the same way, and print the `collect+assert took N s` line. A red job from real findings (assertions failing on web.dev's own issues) is expected, not a failure of the workflow.
Optional: run it on **your own site**, and once with `runs: 3`, to see whether your site's WAF tolerates the repeated requests; if not, lower `LHCI_SEO_CRAWL_MAX_PAGES`, `LHCI_SEO_CRAWL_MAX_LINK_CHECKS`, `LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS` and `LHCI_SEO_HREFLANG_MAX_CHECKS` (the README's request-budget table lists them all).

### E. Phase 13: verify `core-web-vitals-field` with a real key (needs you)

The audit was built and run live without a key (not applicable), with a key on localhost (nothing sent) and against the real Google endpoint with a fake key (a clear 400), but **the
success path has never seen real data**. Create a Google Cloud API key, enable the "Chrome UX Report API" (free), then
`LHCI_SEO_CRUX_API_KEY=<key> npx lhci collect --url=<a busy public site, for example https://web.dev/> --settings.configPath=packages/seo-audits/src/lighthouse-config.js` and read the table.
**Pass when** it shows LCP, INP and CLS with a Google rating and a collection period, says whether the URL or the whole site answered, and the key does not appear in the report JSON.
A low-traffic site returns "no data", which is expected. Anything off is a `fix(seo-audits)` commit with a test using the real response shape.

### H. Phase 17: verify the real destinations (needs you)

The webhook service was built and run end to end with real Chrome and a real server, and its outbound requests are tested against fakes of the documented GitHub, GitLab, Slack and Teams APIs, but **no real pull request comment, alert or webhook delivery has been seen**. The steps are in `docs/qa/webhook-platform.md` ("Not verified"): a real GitHub or GitLab token commenting once and editing (not duplicating) on a second push; a real Slack and Teams alert for a new `noindex`; a real GitHub *Recent Deliveries* answer; a container run with `LHCI_SEO_SERVICE_CHROME_FLAGS=--no-sandbox`. **Pass when** each does what the document says. Anything off is a `fix(...)` commit with a test using the real response shape.

### I. Phase 18: more real sites for the new audits

The Phase 18 audits were checked live on real pages where they could be (IKEA and Allbirds product pages, the real New York Times news and video sitemaps, GitHub, web.dev, the Guardian) and on purpose-built sites with known defects for every positive path, which is how most of the defects in `docs/phases/phase-18-vertical-audits.md` were found. **Not covered live:** a real shop whose crawl is complete enough for `product-category-linking` and `product-pages-in-sitemap` to judge (Etsy refuses headless Chrome; IKEA's crawl and sitemap are too big); a real local-business site with several locations; a real video watch page. Run `lhci collect` on your own shop, local-business and publisher sites and read the six groups in `docs/qa/vertical-audits.md`. Anything that fires on a site you know to be correct is a `fix(seo-audits)` commit with a test.

## 3. Decisions and limits worth knowing

- **`orphan-pages` is usually not applicable with the default crawl limits.** It is only judged when the crawl saw the whole site, so on a site of more than about 50 pages it says "not
  applicable" and names the limit. To use it on a bigger site, raise `LHCI_SEO_CRAWL_MAX_PAGES` (up to 200) and `LHCI_SEO_CRAWL_MAX_DEPTH` (up to 5) and accept the longer crawl. Above 200 pages
  it cannot be judged with this crawler (a new decision: a dedicated crawl command, or sitemap-only orphan detection).
- **`pagination-trap` (now informational) needs a deeper crawl for a next-only endless chain.** At depth 3 such a chain reads "too few to call it a trap"; at `LHCI_SEO_CRAWL_MAX_DEPTH=5` it
  is flagged. A `rel=next` loop longer than 50 pages is not detected.
- **Decided against, with reasons (2026-10-06):** (1) a shared input guard that turns a wrong-shaped core artifact into "not applicable": no real run produces such shapes (Lighthouse's own gatherers do not), Lighthouse already turns a thrown audit into one error row, and a guard would hide a genuine bug as a quiet N/A; (2) folding the three URL-variant audits into one: with `url-normalization` informational nothing is counted twice, and removing audit ids would break users' assertions; (3) a per-host cap on hreflang requests: measured at 7 to 9 s per run, and a cap would halve coverage for the usual single-domain site; (4) caching the per-run link checks: it would hide a link that broke between runs.
- **`sitemap-url-status` scores 1 when its time budget runs out** before the sample finishes (a pinned behaviour).

## 4. Housekeeping

- **Failing suites outside `seo-audits` (investigated 2026-10-06):** the fork's own commits touch only `packages/seo-audits`; everything else is upstream's history. Of the 8 suites that
  failed on this Node 24 machine, 2 are fixed and 6 remain. Fixed: `utils/test/build-context.test.js` (the clone had no git tags, fixed by `git fetch upstream --tags`, plus 2 tests that assumed
  `origin` is `GoogleChrome/lighthouse-ci`; they now compare with this clone's own `origin`) and `cli/test/wizard.test.js` (Node 24 prints a `url.parse()` deprecation from sqlite3's
  `@mapbox/node-pre-gyp` into stderr; the wizard test now runs with `--no-deprecation`; it passed on Node 18 already). **Remaining, all pixel comparisons against screenshots made on
  upstream's machine:** `viewer/test/e2e/simple-comparison`, `viewer/test/e2e/different-category-comparison`, `server/test/e2e/project-dashboard`, `project-dashboard-empty`,
  `project-dashboard-mixed-v5-v6` and `server/test/ui/storybook` (0.4% to 2.5% of pixels, text edges and 1px offsets; the layout is identical). They are rendering differences from this
  machine's fonts and Chrome, not defects. Judge them in CI (the runner that made the goldens), or regenerate the goldens there; regenerating them here would only move the problem. The storybook run
  also writes two new untracked snapshots for the Lighthouse 12.6.1 stories (`version-1261`) that upstream does not have; delete them, do not commit them.

## 5. Deferred features (choices, not bugs)

| Item | From | Note |
|------|------|------|
| Soft-404 content heuristics ("not found" wording on a 200 page) | Phase 5 | needs many pages |
| Per-URL indexability decision tree across the whole site | Phase 6 | Phase 6 judges the audited page and its canonical target |
| Canonical target on a different origin | Phase 6 | recorded, never requested (one request per audited page is the bound) |
| Check every sitemap URL and every child sitemap | Phase 4 | currently a bounded sample (10, max 25) and the first 10 sitemap files |
| Near-duplicate content (similarity / shingling) | Phase 7 | exact hashes only today; similarity is its own false-positive decision |
| A separate `seo-crawl` command writing the snapshot ahead of `lhci collect` | Phase 7 | only if the in-run crawl time becomes a problem |
| Following redirects for a sitemap URL | Phase 4 | needs a re-validating redirect mode in `safe-fetch.js` (a security-reviewed path) |
| Sitemap image/video/news extensions, text/RSS/Atom sitemaps, nested indexes | Phase 4 | tolerated, never reported invalid |
| `llms.txt` link reachability, `llms-full.txt`, `llms.txt` at a subpath | Phase 4 | |
| HTTP `Link` header canonicals | Phases 4, 6 | core's `canonical` audit covers headers |
| Microdata / RDFa; cross-checking structured data against visible content | Phase 2 | |
| Auto-detecting Google doc changes; LLM rule extraction | Phase 2 | intended, sequenced after real usage |
| `robots.txt` wildcard/`$` overlap detection | Phase 4 | exact-match only today |
| Fuzzy / semantic matching (title similarity, H1 relevance, generic titles) | Phase 1 | heuristics are literal today |
| Fetching the canonical to confirm it resolves; numeric `og:image` thresholds | Phases 1, 3 | |
| HTTP-header hreflang, hreflang request cap per host | Phase 11 | headers are not read; the 20 s total budget bounds the time |

Not possible, by policy or physics: exact parity with Google's Rich Results Test; a true visual social-card render inside Lighthouse's report; autonomous publishing of ruleset changes
without human review. Details in `docs/phases/phase-2-structured-data.md` and `phase-3-social-metadata.md`.

## 6. How to close an item

1. Do the steps; if it passes, delete the item here and any matching "Not verified" line in `docs/qa/*.md` and `.ai-agents/state/security-findings.md`.
2. If it finds a problem, add an entry to `.ai-agents/state/security-findings.md` (a risk) or `.ai-agents/state/ci-backlog.md` (a gap), fix it on its own `fix/...` branch with a test.
3. Re-run `npm run test:quick`, and keep the `seo-audits` suites green.
