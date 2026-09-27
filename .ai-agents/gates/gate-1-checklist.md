# Gate 1 — Audit Spec & Contract Review

Review after both `/design-audit` and `/design-contract` complete, before `/sequence-tasks`.

## Audit spec

- [ ] Agent 01 actually ran the upstream-sync check (Step 0) and it's noted in the spec — not skipped.
- [ ] The extension point cited (config key / plugin hook) is real — spot-check it against
      `node_modules/@lhci/utils` or `@lhci/cli`, don't just trust the citation.
- [ ] Scoring function and failure threshold are concrete, not vague ("reasonable score").
- [ ] Category placement makes sense — doesn't silently distort an existing category's weight.

## Feature contract

- [ ] TypeScript types match the audit spec's output shape exactly.
- [ ] New `.lighthouserc.js` config keys have sensible defaults (a fresh install shouldn't need new
      config to get sensible behavior).
- [ ] Assertion preset severities are deliberate choices, not all defaulted to the same value.

If either output fails a check: re-run the corresponding command with corrected direction. Don't
proceed to `/sequence-tasks` with a mismatched audit spec and contract.
