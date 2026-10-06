# Open items

Rewritten 2026-10-06 at `main` = `16ab82d` (Phases 1-15 merged, calibration rounds 1-3 merged). This file lists only what is **still open**: checks not yet
done, decisions waiting, and deferred features. What was finished is in `docs/phases/`, `docs/qa/`, `.ai-agents/state/changelog-draft.md`,
`.ai-agents/state/security-findings.md` and `seo-audits-review-2026-10-05.md` (the review and its status notes).

## 1. Where things stand

| Area | State |
|------|-------|
| Audits | 99 in the `seo-extended` category: 57 scored (error tier at `error`, 7 warn-tier audits at score 0.5) and 42 informational. `packages/seo-audits/src/recommended-assertions.json` asserts the scored ones. |
| `seo-audits` tests | 112 suites / 1,989 tests pass, on Node 24 and on Node 18.20.8 (what CI pins), checked 2026-10-06. Typecheck, lint and prettier clean. |
| Security findings | **None open.** Findings 1-10 are fixed. One risk is *accepted*, not fixed: `LHCI_SEO_ALLOW_PRIVATE_NETWORK` lets the audits reach private addresses; set it only on jobs that audit hosts you control (the README says so). |
| Viewer | `@lhci/viewer` renders all 34 audits that had tables in five real reports (2026-10-06); the server and `seed-database` path was checked on 2026-10-05. |
| Failing suites outside `seo-audits` | About 9-11 suites in `cli`, `server`, `viewer`, `utils` (see section 4). Not caused by this work. |
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

### G. Real-site spot check: the types not yet covered

Done 2026-10-06 on MDN, BBC News, apple.com, ikea.com and Wikipedia (found and fixed six false positives). **Still to look at**, one real site each:

- a **multilingual site with an `x-default` language chooser** (the hreflang audits and the `x-default` exemption), and one whose hreflang is **only in the sitemap**;
- a **retail home page with a carousel** (`image-lazy-above-fold`, `hidden-text`);
- a site with a JSON-LD **Article plus a Review** (`content-dates`);
- a **Next.js / React / Angular site** (`rendering-mode`, `hydration-errors`, `js-*`), and a site that serves mobile differently (`device-content-parity`);
- a **page about templates or lorem ipsum** (`placeholder-content`), and **real prose** for the readability numbers;
- the Phase 15 AI reports (the question-heading heuristic on real content).

Look for audits that fire on healthy pages; a script-built site wrongly judged thin or duplicate should say "not applicable". Anything wrong is a `fix(seo-audits)` commit with a test.

### R13 (rest). AI crawler names not yet checked against vendor pages

OpenAI, Anthropic, Perplexity, Google-Extended and Applebot-Extended were confirmed on 2026-10-06. Not re-checked: `CCBot`, `Bytespider`, `Amazonbot`, `Meta-ExternalAgent`,
`DuckAssistBot` (in `src/lib/ai-crawlers.js`). OpenAI also lists `OAI-AdsBot`, which is not in the list.

## 3. Decisions and limits worth knowing

- **`orphan-pages` is usually not applicable with the default crawl limits.** It is only judged when the crawl saw the whole site, so on a site of more than about 50 pages it says "not
  applicable" and names the limit. To use it on a bigger site, raise `LHCI_SEO_CRAWL_MAX_PAGES` (up to 200) and `LHCI_SEO_CRAWL_MAX_DEPTH` (up to 5) and accept the longer crawl. Above 200 pages
  it cannot be judged with this crawler (a new decision: a dedicated crawl command, or sitemap-only orphan detection).
- **`pagination-trap` (now informational) needs a deeper crawl for a next-only endless chain.** At depth 3 such a chain reads "too few to call it a trap"; at `LHCI_SEO_CRAWL_MAX_DEPTH=5` it
  is flagged. A `rel=next` loop longer than 50 pages is not detected.
- **Optional, not done:** fold the three URL-variant audits into one (instead `url-normalization` became informational); expose `numericValue` from the audits that do not yet (17 do);
  cache the per-run link checks by audited URL (decided against: it would hide a link that broke between runs).
- **`sitemap-url-status` scores 1 when its time budget runs out** before the sample finishes (a pinned behaviour).

## 4. Housekeeping

- **`docs/phases/phase-1-page-metadata.md` is stale.** Its "Not possible without new infrastructure" table still lists duplicate titles and duplicate meta descriptions as impossible; Phase 7
  built them. Move those rows to done. The same file calls roadmap Phase 16 "Site Intelligence & Multi-page Crawler", while `docs/master-roadmap.md` calls it "Site Intelligence / Product
  Layer": align the two.
- **Failing suites outside `seo-audits`:** Storybook, Puppeteer and e2e suites in `server` and `viewer`, plus `cli/test/autorun-github.test.js`, `cli/test/upload.test.js`,
  `cli/test/wizard.test.js` and `utils/test/build-context.test.js`. Run them once on a clean checkout of upstream `main` to confirm they fail there too; the causes were not investigated.
  They only matter if you want a fully green local `npm run test`.

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
