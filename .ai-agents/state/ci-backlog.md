# CI backlog

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

<!-- Appended by Agent 08. Advisory only — does not block merges or new features. Format per entry:

## {date} — {slug}

- item: {description of the gap or improvement}
- status: open | done
-->
