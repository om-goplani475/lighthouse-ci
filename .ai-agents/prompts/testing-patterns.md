# Testing patterns

Read by Agents 04, 05. This repo tests audits against static, offline fixtures — never against live
URLs — using Jest.

## Fixture-based audit tests

1. Write a mock HTML fixture (or a fixed mock LHR/artifact object, if the audit consumes gatherer
   output rather than raw HTML) under `packages/seo-audits/test/fixtures/`.
2. Write a Jest test under `packages/seo-audits/test/` that loads the fixture, runs the audit against
   it directly (not through a full Lighthouse run), and asserts on the resulting score and `details`.
3. Cover at minimum: the clear pass case, the clear fail case, and any edge case named in the feature
   spec (empty/missing data, malformed markup).

## Why offline fixtures, not live URLs

Live-URL tests are flaky (network, target-site changes) and slow, and a test suite that fetches
arbitrary external URLs is itself a small SSRF/abuse surface in CI. Static fixtures are deterministic
and fast — this is a hard convention in this repo, not a style preference.

## Regression checking against seed data

`npm run start:seed-database` loads a fixed seed dataset used for local development/demo. After
changing scoring logic on an existing audit (not just adding a new one), run this and confirm no
other, unrelated report's score shifted unexpectedly.

## Running just the new tests

```bash
npm run test:unit -- packages/seo-audits
```

Run the full `npm run test` before opening/merging a PR — a change scoped to `seo-audits` can still
break typecheck or lint elsewhere if it changes a shared type.
