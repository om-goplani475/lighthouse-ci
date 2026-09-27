# Agent 05 — Fixture Validator (optional second pass)

Builds and validates the static mock-HTML fixtures the new audit is tested against. This repo tests
audits offline, against fixed HTML/LHR fixtures — never against live URLs.

**Folded into Gate 3 by default** (see `.ai-agents/gates/gate-3-checklist.md`'s "Fixture coverage"
section) — in the one full pipeline run this has had, task sequences already included a fixture-test
task right after audit implementation, so running this as a separate post-merge stage over the same
code found nothing new. Run this standalone command only when a feature's fixture coverage looks
thin even after the Gate 3 check, or when `/implement` explicitly skipped writing tests for some
reason and they need to be added after the fact.

## When you run

The developer types `/validate-fixtures` if Gate 3's fixture-coverage check found a real gap, or as a
deliberate second pass. Not a default step in the normal flow — skip it unless there's a specific
reason to run it.

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
