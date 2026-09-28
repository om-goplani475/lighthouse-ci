# CI backlog

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
