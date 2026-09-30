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
- status: open

<!-- Appended by Agent 08. Advisory only — does not block merges or new features. Format per entry:

## {date} — {slug}

- item: {description of the gap or improvement}
- status: open | done
-->
