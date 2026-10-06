# CI backlog

## 2026-09-29 — structured-data-type-conflicts

- item: no gap found. New rule-engine module, new ruleset namespace, and a new audit — no new
  dependency (`package.json` untouched, confirmed via diff), no native/system dependency, no new
  build step. `registry.js`'s modification is additive (one new exported function) and doesn't
  change CI requirements. Existing `test:typecheck`/`test:lint`/`test:unit` pipeline already covers
  everything touched. No Dockerfile exists to update. No CI changes made.
- status: done (nothing to do)

## 2026-09-29 — structured-data-rich-result-eligibility

- item: no gap found. New audit file + test + README/config changes only — no new dependency
  (`package.json` untouched, confirmed via diff), no native/system dependency, no new build step.
  Existing `test:typecheck`/`test:lint`/`test:unit` pipeline already covers everything touched. No
  Dockerfile exists to update. No CI changes made.
- status: done (nothing to do)

## 2026-09-28 — structured-data-remaining-types

- item: no gap found. This feature is additive JSON ruleset data plus test-file changes only — no
  new dependency (`packages/seo-audits/package.json` untouched, confirmed via diff), no new native/
  system dependency, no new build step. `2026-10.json`'s files are picked up automatically by the
  existing generic schema-validation test (it `readdirSync`s the `rules/` directories rather than
  naming files), and the existing `test:typecheck`/`test:lint`/`test:unit` pipeline already covers
  everything touched. No Dockerfile exists to update. No CI changes made.
- status: done (nothing to do)

## 2026-09-28 — structured-data-rule-engine

- item: no gap found. New `ajv` dependency (task-01) is a pure-JS npm package, no native bindings,
  no system dependency — `yarn install` in existing CI already handles it, confirmed via a fresh
  `npm run test:typecheck`/`test:lint` pass. No Dockerfile exists to update. No CI changes made.
- status: done (nothing to do)

## 2026-09-27 — structured-data-validation

- item: no gap found. `packages/seo-audits` is picked up automatically by the existing
  `yarn test:typecheck`/`test:lint`/`test:unit:ci` scripts (confirmed, not assumed) — no Dockerfile
  exists in this repo to update, and this feature has no native/system runtime dependency. No CI
  changes made.
- status: done (nothing to do)

## 2026-09-30 — sitemap-fetch-and-parse

- item: no gap found. `saxes@^6.0.0` (new dependency) is pure JS, already in `yarn.lock`, and
  `yarn install --frozen-lockfile` (what `ci.yml` runs) passes with it declared. `packages/seo-audits`
  is picked up by the existing root `test:typecheck`/`test:lint`/`test:unit` scripts. CI pins Node 18;
  the seo-audits suite was re-run under Node 18.20.8 (not just the dev machine's Node 24) and all 475
  tests pass, which matters because the new tests use `server.closeAllConnections()` (Node 18.2+) and
  zlib `maxOutputLength`. No Dockerfile exists. No CI changes made.
- status: done (nothing to do)

- item: the full `npm run test` showed 12 failing suites on the dev machine, mostly the
  Storybook/Puppeteer image tests in `packages/server`. This feature changes nothing there, but the
  failures were never confirmed against `phase-4-robots-sitemap` before the merge. Worth running the
  same suites on the base commit (or reading a recent green CI run) so a real regression can't hide
  behind "probably environment".
- resolved 2026-10-01: ran every suite outside seo-audits on `main` (d81c198) and on the pre-Phase-4 base
  (9825814). Same failure families on both (CLI, server e2e/Storybook, viewer e2e, utils build-context):
  12 failing suites / 106 tests on main, 14 / 111 on base. The sets differ by a few suites that fail
  intermittently under load (collect-psi on main; autorun-start-server, collect, upload on base), so those
  are flaky, not caused by this work. `git diff 9825814..main` touches nothing outside `packages/seo-audits`,
  `docs/` and `.ai-agents/`, so a regression from Phase 4 is not possible in those packages.
- status: done

## 2026-10-01 — sitemap-indexability

- item: no gap found. `parse5@^7.1.1` (new declared dependency) is pure JavaScript, already in the tree
  via `jsdom`, and its range is already in `yarn.lock`; `yarn install --frozen-lockfile` (what `ci.yml`
  runs) passes with it declared and reports no change. The seo-audits suite (808 tests, 54 suites) was
  run under Node 18.20.8, the version CI pins, and passes: relevant because the new tests rely on
  `server.closeAllConnections()` and on `parse5` loading under both Jest's CommonJS transform and real
  Node ESM. No Dockerfile exists. No CI changes made.
- status: done (nothing to do)

- item: still open from the sitemap-fetch-and-parse entry: the 12 failing suites in a full
  `npm run test` (mostly Storybook/Puppeteer image tests in `packages/server`) have never been compared
  with the base branch. This feature again touched only `packages/seo-audits`, so it adds no new
  evidence either way.
- resolved (same check as above) 2026-10-01: ran every suite outside seo-audits on `main` (d81c198) and on the pre-Phase-4 base
- status: done

- item: worth knowing for any CI job that runs these audits: `lhci assert` prints "All results
  processed!" and exits 0 when there is no report to check, so a `lhci collect` that failed to produce
  one (for example Chrome refusing an interstitial) followed by a separate `lhci assert` step passes
  silently. `lhci autorun` runs both as one pipeline and fails on a collect error, which is what the
  workflow the developer shared uses, so no change is needed there.
- status: done (documented in `docs/qa/sitemap-indexability.md`)

## 2026-10-01 — transport-security

- item: no gap found. No dependency was added (`package.json`, `yarn.lock` and `.github/` are unchanged by
  the feature's diff), no new script or build step, no Docker config exists. The new suites and the
  config-resolution test (68 tests) were run under Node 18.20.8, the version `ci.yml` pins, and pass.
  No CI changes made.
- status: done (nothing to do)

- item: worth knowing for anyone adding the certificate assertion to a CI job: one assertion per audit id
  means "fail on expiry, warn at 15 days" needs an `assertMatrix` (two entries on the same URL pattern),
  and `assertMatrix` cannot be combined with `preset` or a top-level `assertions` block in the same
  `assert` config (lhci throws "Cannot use assertMatrix with other options"). Documented in the README
  and checked with a real `lhci assert`.
- status: done (documented in `packages/seo-audits/README.md` and `docs/qa/transport-security.md`)

## 2026-10-01 — soft-not-found

- item: no gap found. No dependency, workflow or Docker change. The new tests and the config-resolution test
  were run under Node 18.20.8, the version `ci.yml` pins (see the run recorded below).
- status: done (nothing to do)

- item: for any CI job: the new audit makes up to four status-only requests to the audited site, and they
  appear as 404s in its access logs; auditing `localhost` or a private staging host needs
  `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` (the run warns and the audit is not applicable without it).
- status: done (documented in the README and the audit description)

## 2026-10-01 — url-variants

- item: no gap found. No dependency, workflow or Docker change; the new suites and the config test were
  run under Node 18.20.8, the version `ci.yml` pins.
- status: done (nothing to do)

- item: for any CI job: the probes send up to 18 status-only requests to the audited site's own `http://`
  and `www` forms (visible in its logs). A staging site on a non-default port, `localhost` or an IP address
  gets "not applicable", not a failure: the variants only make sense at the real host name on ports 80/443.
- status: done (documented in the README and each audit's description)

## 2026-10-01 — indexability

- item: no gap found. No dependency, workflow or Docker change; the new suites and the config test were run
  under Node 18.20.8, the version `ci.yml` pins (recorded below).
- status: done (nothing to do)

- item: for any CI job: a page whose canonical points elsewhere on the same site triggers one extra
  status request to that URL (visible in the site's logs); on `localhost` or a private staging host it needs
  `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` or it is skipped as a note. To audit an error page (4xx/5xx) at all,
  set `ignoreStatusCode: true` under `ci.collect.settings`; Lighthouse otherwise stops with no results.
- status: done (documented in the README)

## 2026-10-01 — site-crawler

- item: no gap found in the workflow files. One dependency was added, `htmlparser2@^6.1.0`, whose range is already in `yarn.lock`:
  `yarn install --frozen-lockfile` passes and `yarn.lock` is byte-identical. The new suites and the safe-fetch and config suites
  (345 tests) were run under Node 18.20.8, the version `ci.yml` pins, and pass. No Docker config exists. No CI changes made.
- status: done (nothing to do)

- item: things worth knowing about the new tests on a shared CI runner: the cache tests create and delete directories under
  `os.tmpdir()`; one test spawns three Node child processes (`--input-type=module`) to prove atomic cache writes; the integration
  test binds three local ports (ephemeral) and one of its cases waits for a real 10 s crawl time budget, so that suite takes about
  10 s. All run inside the existing `jest --maxWorkers=2`.
- status: done (documented here)

- item: for a CI job that runs the fork config: the crawl sends up to about 100 requests to the audited site on a cold cache and can
  take up to `LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS` (default 120 s) inside the first run that needs it; `LHCI_SEO_CRAWL=0` switches
  it off, and a run limited to Lighthouse's own categories does not crawl. The default cache directory is under the runner's temp
  directory, so a fresh runner per job means no reuse across jobs (reuse across the URLs and runs of one `lhci collect` works).
- status: done (documented in the README)

- item: follow-up from the security review (Finding 8, low): give `safeFetchBytes` the same validated `userAgent` option so the
  crawler's robots.txt and sitemap requests identify themselves.
- status: done (2026-10-01)

## 2026-10-05 — link-graph-crawler

- item: no gap found in the workflow files. No dependency was added (`package.json` and `yarn.lock` are unchanged by the feature's diff), no new script
  or build step, no Docker config exists. The seo-audits suites (75 suites) pass; the Node 18.20.8 re-run for this change is still to do (listed in
  `docs/open-items.md`).
- status: done (nothing to do)

- item: for any CI job: the crawl now follows links for up to 3 hops and starts from the homepage too, so a cold crawl sends up to about 150 requests
  (3 per page at most, 50 pages by default) instead of about 100 and finishes by hitting the page cap or the 120 s budget on a big site.
  `LHCI_SEO_CRAWL_MAX_DEPTH` (1 to 5) tunes it. The snapshot version and the depth are in the cache key, so the first run after upgrading re-crawls.
- status: done (documented in the README)

- item: follow-up from the security review (Finding 10, low): give the snapshot a byte budget for stored links, or a lower URL length for them, so a hostile
  site cannot make it exceed the 16 MiB cache cap.
- status: done (2026-10-06: the extractor stores at most 40,000 characters of link URLs per page)

## 2026-10-05 — link-graph-audits

- item: no gap found. No dependency, workflow or Docker change; `package.json`, `yarn.lock` and `.github/` are unchanged by the feature's diff. The new suites are pure
  (no network, no disk) and fast. The Node 18.20.8 re-run is still to do (see `docs/open-items.md`, A5).
- status: done (nothing to do)

## 2026-10-05 — link-check-audits

- item: no gap found in the workflow files. No dependency, workflow or Docker change; `package.json`, `yarn.lock` and `.github/` are unchanged by the feature's diff. The Node 18.20.8
  re-run is still to do (`docs/open-items.md`, A5).
- status: done (nothing to do)

- item: for any CI job: every Lighthouse run now sends up to about 300 extra status-only requests to the audited site (100 of the audited page's own links, 3 hops each), per run,
  not cached; with `numberOfRuns` > 1 they repeat. They add up to 30 s to a run in the worst case. `LHCI_SEO_CRAWL_MAX_LINK_CHECKS` (0 to 200, default 100) tunes or switches them off.
- status: done (documented in the README)

## 2026-10-05 — anchor-text-audits

- item: no gap found. No dependency, workflow or Docker change; `package.json`, `yarn.lock` and `.github/` are unchanged by the feature's diff. The new suites are pure and fast. The Node 18.20.8
  re-run is still to do (`docs/open-items.md`, A5).
- status: done (nothing to do)

## 2026-10-05 — pagination-audits

- item: no gap found. No dependency, workflow or Docker change; `package.json`, `yarn.lock` and `.github/` are unchanged by the feature's diff. The new suites are pure and fast. The Node 18.20.8
  re-run is still to do (`docs/open-items.md`, A5).
- status: done (nothing to do)

## 2026-10-05 — external-link-audit

- item: no gap found in the workflow files. No dependency, workflow or Docker change; `package.json`, `yarn.lock` and `.github/` are unchanged by the feature's diff. The Node 18.20.8 re-run is still to do
  (`docs/open-items.md`, A5).
- status: done (nothing to do)

- item: for any CI job: every Lighthouse run now sends up to 20 status-only requests (2 per host, 15 s) to **other people's sites**, the external links of the audited page. A runner that cannot reach the internet, or a
  corporate proxy, will see them fail (DNS or connection errors count as "broken" only for DNS failure and refused connections; others are listed and never fail). `LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS=0` switches
  the checks (and the audit) off. A job that audits a private site behind a firewall will see the page's external links time out: those are "unreliable", not failures.
- status: done (documented in the README)

<!-- Appended by Agent 08. Advisory only — does not block merges or new features. Format per entry:

## {date} — {slug}

- item: {description of the gap or improvement}
- status: open | done
-->

## 2026-10-06 — state sync after the calibration

- item: the Node 18.20.8 re-runs listed as "still to do" in the Phase 8 entries above were done: `jest packages/seo-audits` under Node 18.20.8 passed (82 suites on 2026-10-05; 112 suites / 1,995 tests on 2026-10-06). The open
  point that remains for CI is the real GitHub Actions run (`docs/open-items.md`, A3).
- status: done

- item: for any CI job: use `packages/seo-audits/src/recommended-assertions.json` as the `assert.assertions` object (error tier at `error`, warn tier at `warn`; informational audits cannot be asserted). Per Lighthouse run the audits
  send up to about 150 crawl requests once per collect plus the per-run requests in the README's request-budget table. The CLI test suites outside `seo-audits` that still fail on a developer machine are screenshot
  comparisons (`docs/open-items.md`, section 4).
- status: done (documented in the README)
