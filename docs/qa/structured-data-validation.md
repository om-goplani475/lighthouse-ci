# QA checklist: Structured Data (JSON-LD) Validation Audit

- slug: structured-data-validation
- merged: f1784cd (commit range 5cef603..f1784cd on main)

## Functional

- [ ] Documented pass case verified against a real page: a page with
      `<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Article", ...}</script>`
      scores 1 on `structured-data-json-ld`.
- [ ] Documented fail case verified against a real page: a page with no JSON-LD block at all scores 0.

## Edge cases

- [ ] Missing/absent expected data: page with zero `<script type="application/ld+json">` blocks —
      confirmed by unit test (`fails when there are no blocks at all`), not yet verified against a
      live-rendered page through the actual `lhci collect` CLI path.
- [ ] Malformed markup: malformed JSON inside the block (confirmed by unit test) — verify this
      doesn't throw and kill the whole LHR run when driven through a real `lhci collect`, not just
      the audit function in isolation.
- [ ] Multiple blocks, one valid one invalid (from the feature spec) — confirmed by unit test that
      each block is reported individually in the details table, not just an aggregate pass/fail.
- [ ] Valid JSON missing `@context`/`@type` (from the feature spec) — confirmed by unit test.

**Note**: all four edge cases above are verified at the unit-test level (mocked artifacts), not yet
through a real `lhci collect` run against an actual page. That's a gap worth closing before treating
this as fully QA'd — the unit tests prove the audit's *logic* is correct; they don't prove the
gatherer correctly extracts `<script type="application/ld+json">` content from a real, rendered page
end-to-end.

## Integration

- [ ] Score composes correctly into the `seo-extended` category total — **not yet verified**. This is
      a brand-new category this fork has never rendered before; unlike every previous audit added to
      an existing Lighthouse category, there's no prior art in this repo for a custom category
      appearing in a real LHR report.
- [ ] Renders correctly in `packages/viewer` — **not yet verified**. `packages/viewer` renders
      whatever categories/audits exist in the LHR JSON it's given; there is no reason to expect it
      breaks on an unfamiliar category id, but this has not been checked against a real report.
- [ ] `configPath` correctly picked up when set in `.lighthouserc.js` — verified functionally via the
      `lighthouse-config.test.js` regression test (real `initializeConfig` resolution), but not via an
      actual `lhci collect --config=...` CLI invocation.
- [ ] `lhci assert` severity — **not applicable as originally scoped**. This feature does not ship a
      preset severity (see `docs/task-sequences/structured-data-validation.md` task-06 — reverted,
      breaks `presets.test.js`'s invariant that preset audits are always core Lighthouse defaults).
      Severity is the consumer's own choice, set in their own `.lighthouserc.js` per
      `packages/seo-audits/README.md`. Check instead: a consumer-set assertion for
      `structured-data-json-ld` in `ci.assert.assertions` is actually enforced by `lhci assert` — not
      yet verified end-to-end.

## Regression

- [ ] `npm run start:seed-database` seed data unaffected — **not run**. This audit is not part of the
      default Lighthouse config (opt-in via `configPath`), so the existing seed data (collected
      without this feature's config) should be entirely unaffected by definition — but this hasn't
      been executed to confirm no unrelated regression.

## Summary

This checklist surfaces a real gap: everything above the unit-test level is unverified. The audit's
own logic is solid (8 passing unit tests covering every documented case), but nothing has confirmed
this works end-to-end through a real `lhci collect` run against a real page with a real
`configPath`-based config, and nothing has confirmed the new `seo-extended` category renders
correctly in `packages/viewer` or `packages/server`. Recommend running one real `lhci collect`
against a test page with `configPath` set before considering this feature done, not just merged.
