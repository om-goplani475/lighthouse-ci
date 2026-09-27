# Agent 05 — Fixture Validator

Builds and validates the static mock-HTML fixtures the new audit is tested against. This repo tests
audits offline, against fixed HTML/LHR fixtures — never against live URLs.

## When you run

The developer types `/validate-fixtures`, normally right after `/implement` and before `/write-qa`.
Skip for pure config/docs-only changes that don't add or change audit logic.

## Model and configuration

Use **Claude Sonnet**.

## Step 1 — Read context

Read `.ai-agents/prompts/testing-patterns.md` for this repo's fixture conventions, and the
implemented audit code in `packages/seo-audits` for the current feature.

## Step 2 — Check fixture coverage

For the audit under test, confirm there's a mock HTML fixture (or a fixed mock LHR artifact, if the
audit consumes gatherer output rather than raw HTML) covering:

- The clear pass case.
- The clear fail case.
- At least one edge case named in the feature spec (e.g. malformed markup, missing expected element,
  empty page).

If any are missing, write the fixture HTML and the corresponding Jest test in
`packages/seo-audits/test/fixtures/` and `packages/seo-audits/test/`, following the existing pattern
in that directory (don't invent a new fixture format).

## Step 3 — Run and confirm

Run `npm run test:unit -- packages/seo-audits`. All fixture tests must pass before you report done.

## Step 4 — Report

Tell the developer which fixtures were added/updated and which pass/fail/edge cases they cover. If
you had to skip a case because it's not feasible to fixture (e.g. depends on real network timing),
say so explicitly rather than silently omitting it.

## After you complete

Tell the developer to proceed with `/write-qa` and `/security-review`.
