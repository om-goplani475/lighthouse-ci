# QA checklist: Meta Description Identical to Title

- slug: meta-description-identical-to-title
- merged: 4faeb68 (branch feat/description-identical-to-title off phase-1-page-metadata)
- built without the full `.ai-agents/` design-doc pipeline (spec/audit-spec/contract/task-sequence)
  — a deliberate, developer-requested lightweight pass for this and the rest of Phase 1's simple,
  single-page, no-new-gatherer checks. Scoring model and near-identical heuristic were still
  confirmed with the developer via a blocking question before implementation, per
  `.ai-agents/prompts/blocking-questions.md`'s spirit even outside the formal pipeline.

## Verified live (real `lhci collect`, not just unit tests)

- [x] **Identical title/description** (`"Buy Running Shoes Online"` for both): `score: 0`,
      explanation "identical to the page title".
- [x] **Near-identical, title + site suffix** (`"Buy Running Shoes Online | Acme Store"`):
      `score: 0`, explanation "nearly identical to the page title" — the exact pattern this
      feature exists to catch, confirmed at the 50%-length-ratio threshold after an initial 80%
      threshold was caught failing this exact case in unit testing (see commit) before it ever
      reached a live run.
- [x] **Substantively different description** (reuses zero title words, real sentence): `score: 1`.

## Verified in unit tests (`test/audits/meta-description-identical-to-title.test.js`, 11 cases)

- [x] Case/whitespace-insensitive exact match, trailing-punctuation-only difference — both
      "identical".
- [x] A description that opens with a few of the same words as the title but goes on to say
      something substantively different is correctly **not** flagged (this was the scenario that
      forced the ratio threshold down from an initial 80% to 50% — the two aren't in tension,
      the substantive-description case sits at ~24% ratio, comfortably below either threshold).
- [x] `notApplicable` when title absent, description absent, or both absent.

## Integration

- [x] `lighthouse-config.test.js` extended — confirms the audit is registered in `audits` and
      `seo-extended.auditRefs` alongside all five pre-existing entries, `extends` preserved.
- [x] No new gatherer — reuses the already-registered `PixelWidth` artifact's `title`/`description`
      text fields, confirmed via the live run (both audits' results present in the same LHR).

## Regression

- [x] `npm run test:typecheck`, `npm run test:lint` clean.
- [x] Scoped `npx jest packages/seo-audits` — all suites passing, no regressions in sibling audits.

## Summary

Scored normally (not informational) since there's no approximate-ruleset caveat here — either the
two strings are duplicated or they aren't. No gaps considered blocking.
