# Open items

Rewritten 2026-10-06 at `main` = `16ab82d` (Phases 1-15 merged, calibration rounds 1-3 merged). This file lists only what is **still open**: checks not yet
done, decisions waiting, and deferred features. What was finished is in `docs/phases/`, `docs/qa/`, `.ai-agents/state/changelog-draft.md`,
`.ai-agents/state/security-findings.md` and `seo-audits-review-2026-10-05.md` (the review and its status notes).

## 1. Where things stand

| Area | State |
|------|-------|
| Audits | 99 in the `seo-extended` category: 57 scored (error tier at `error`, 7 warn-tier audits at score 0.5) and 42 informational. `packages/seo-audits/src/recommended-assertions.json` asserts the scored ones. |
| `seo-audits` tests | 112 suites / 1,995 tests pass, on Node 24 and on Node 18.20.8 (what CI pins), checked 2026-10-06. Typecheck, lint and prettier clean. |
| Security findings | **None open.** Findings 1-10 are fixed. One risk is *accepted*, not fixed: `LHCI_SEO_ALLOW_PRIVATE_NETWORK` lets the audits reach private addresses; set it only on jobs that audit hosts you control (the README says so). |
| Viewer | `@lhci/viewer` renders all 34 audits that had tables in five real reports (2026-10-06); the server and `seed-database` path was checked on 2026-10-05. |
| Failing suites outside `seo-audits` | 6 screenshot suites in `server` and `viewer` fail on this machine only (see section 4); the rest pass. Not caused by this work. |
| Not verified at all | The real GitHub Actions run (A3) and the CrUX success path with a real key (E). |

## 2. Checks still to do

### A3. A real GitHub Actions run with the fork config (the real run is yours)

Simulated locally on 2026-10-05 (not a GitHub runner): `yarn install --frozen-lockfile` left `yarn.lock` unchanged, the global `@lhci/cli@0.15.1` (with its own
`lighthouse` 12.6.1) ran the fork config and found every fork audit, the env vars reached the child processes, each crawled page was requested once across URLs, the cache
directory is mode 700, and Node 18.20.8 worked. Note: `lhci autorun` with no `assert` block falls back to `lighthouse:recommended` and fails on its performance assertions, so a real
workflow needs its own `assert` section (use `recommended-assertions.json`).

**Still needs a real run:** the runner's egress and DNS, a shared runner's temp directory, your actual `.github/workflows`, and the cost and time of a cold crawl on a real site.
Point `collect.settings.configPath` at `require.resolve('@lhci/seo-audits/src/lighthouse-config.js')`, run `lhci autorun`, and check:

- **Two Lighthouse copies:** `npm ls lighthouse`. **Pass when** the "Extended SEO (fork)" category exists with no "audit not found".
- **Time and requests:** how long the first run takes with the crawl on (up to about 150 requests, up to 120 s) and whether the page cap or the time budget ended it (the `crawl-coverage`
  notes say which). Also what the per-run requests add (up to 100 internal link checks, 20 external checks, 10 hreflang alternates; the README has the full table) and whether the audited
  site's logs tolerate them. If not: lower `LHCI_SEO_CRAWL_MAX_PAGES`, `LHCI_SEO_CRAWL_MAX_LINK_CHECKS`, `LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS`, `LHCI_SEO_HREFLANG_MAX_CHECKS`, or switch things off.
- **External links:** a runner with no outbound access must degrade to "unreliable", never to false "broken" links; a site with a known dead external link must fail
  `broken-external-links`, and `LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS=0` must make it not applicable. Not verified against many real third-party sites (rate limiters, tarpits).
- **Shared runner:** if the run warns that the cache is unusable, the crawl still works but each run crawls again.

### E. Phase 13: verify `core-web-vitals-field` with a real key (needs you)

The audit was built and run live without a key (not applicable), with a key on localhost (nothing sent) and against the real Google endpoint with a fake key (a clear 400), but **the
success path has never seen real data**. Create a Google Cloud API key, enable the "Chrome UX Report API" (free), then
`LHCI_SEO_CRUX_API_KEY=<key> npx lhci collect --url=<a busy public site, for example https://web.dev/> --settings.configPath=packages/seo-audits/src/lighthouse-config.js` and read the table.
**Pass when** it shows LCP, INP and CLS with a Google rating and a collection period, says whether the URL or the whole site answered, and the key does not appear in the report JSON.
A low-traffic site returns "no data", which is expected. Anything off is a `fix(seo-audits)` commit with a test using the real response shape.

### G. Real-site spot check (done twice; more sites always help)

Done 2026-10-06 on 15 real sites in two rounds. Round 1: MDN, BBC News, apple.com, ikea.com, Wikipedia (six false positives fixed). Round 2: spotify.com, lego.com, nike.com, rottentomatoes.com,
theguardian.com, nextjs.org, react.dev, angular.dev, lipsum.com, paulgraham.com (no runtime error and no audit error row on any; four false positives fixed: a 406 or 403 on a probe read as a
defect in `url-variant-consistency` and `indexability-conflicts`, a lazy image at the very bottom of the first screen, and Next.js app-router pages not recognised in `rendering-mode`).
What fired afterwards looked genuine (missing og tags, no `<h1>`, a sitemap URL that 404s or redirects, SPAs answering 200 for any path, `sitemap.xml` serving HTML).
**Known and accepted:** `placeholder-content` fails a page that is itself about lorem ipsum (lipsum.com), as its description says.
**Round 3 (hreflang chooser):** ikea.com's root (a real country chooser with `x-default`) and stripe.com (89 alternates) were run: the `x-default` exemption works, the audits stay quiet on a healthy set, and the real error IKEA ships (`es-CE`, not a region code) is reported. The hreflang requests added 7 to 9 s per run, inside the 20 s budget.
**Not covered:** a site whose hreflang is only in the sitemap.

### R13 (rest). Bytespider

`Bytespider` (ByteDance) is the one crawler name not confirmed: ByteDance publishes no reachable vendor page, so it is documented only by third parties. All 18 others in `src/lib/ai-crawlers.js` were checked against vendor pages on 2026-10-06.

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
