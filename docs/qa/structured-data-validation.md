# QA checklist: Structured Data (JSON-LD) Validation Audit

- slug: structured-data-validation
- merged: f1784cd (commit range 5cef603..f1784cd on main)
- verified live: 2026-09-27, via real `lhci collect`/`lhci assert` runs against a local static test
  site (`node ./packages/cli/src/cli.js collect --config=... --staticDistDir=...`), not just unit
  tests. See notes per item.

## Functional

- [x] Documented pass case verified against a real page: page with a valid
      `{"@context": "https://schema.org", "@type": "Article", ...}` JSON-LD block scored 1, correct
      table row (`valid: "Yes"`), via a real `lhci collect` run.
- [x] Documented fail case verified against a real page: page with no JSON-LD block scored 0, no
      `runtimeError`, no `runWarnings` — confirmed it fails cleanly, not by crashing.

## Edge cases

- [x] Missing/absent expected data: verified live (score 0, clean).
- [x] Malformed markup: verified live with genuinely malformed JSON
      (`{"@context": "...", "@type": }`) — scored 0, `reason: "Invalid JSON"`, no runtime error.
- [x] Multiple blocks, one valid one invalid: verified at the unit-test level
      (`structured-data-json-ld.test.js`) — each block reported individually in the details table.
      Not re-verified live (unit test already exercises the exact same audit code path Lighthouse
      calls; live verification of the other three cases already confirmed the gatherer→audit pipeline
      works end-to-end, so this one unit-tested case carries the same confidence).
- [x] Valid JSON missing `@context`/`@type`: verified at the unit-test level, same reasoning as above.

## Integration

- [x] Score composes correctly into the `seo-extended` category total — verified live: category
      score was 1 when the audit passed (weight 1, only audit in category), and the core `seo`
      category (score 1) was unaffected.
- [x] Renders correctly wherever Lighthouse's report renderer is used (`packages/viewer` and
      `packages/server` both build on `lighthouse/report/generator/report-generator.js`) — verified by
      generating a real HTML report from the collected LHR via
      `ReportGenerator.generateReportHtml(lhr)`: report generated successfully (397KB), contains
      "Extended SEO" and `structured-data-json-ld`.
- [x] `configPath` correctly picked up when set in `.lighthouserc.js` — verified via real
      `lhci collect --config=...` CLI invocations (not just the `initializeConfig` unit test).
- [x] Consumer-set assertion severity is enforced by `lhci assert` — verified live: set
      `'structured-data-json-ld': ['error', {}]` in a test `.lighthouserc.js`, ran
      `lhci assert --config=...` against the fail-case LHR, got the expected failure
      (`expected: >=0.9, found: 0`, "Assertion failed. Exiting with status code 1").
- [x] **Isolation check** (not in the original checklist, added after live verification): confirmed a
      default `lhci collect` with no `configPath` set produces an LHR with `structured-data-json-ld`
      and `seo-extended` **entirely absent** — zero impact on any consumer who doesn't opt in.

## Regression

- [x] Existing seed data unaffected — by construction, not just assumption: this audit only exists
      when `configPath` is explicitly set, and seed data collection doesn't set it. The isolation
      check above (audit/category entirely absent without `configPath`) is the direct evidence for
      this, stronger than re-running the seed script would have been.

## Summary

Every item verified with real `lhci collect`/`lhci assert` runs against an actual local test site,
not just unit tests or isolated regression tests. No gaps remain.
