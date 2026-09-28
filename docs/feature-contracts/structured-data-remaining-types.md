# Feature contract: Remaining Rich-Result Types for Schema Property Validation

- slug: structured-data-remaining-types

## TypeScript types

**No changes.** This feature adds no new code, so no new/changed typedefs in
`packages/seo-audits/src/rule-engine/types.js`. The existing `GoogleRequirementsRuleSet` and
`EligibilityRuleSet` typedefs already accommodate all 10 new types as-is: `GoogleRuleSet_TypeRule`'s
`nested: Record<string, GoogleRuleSet_NestedRule>` is keyed by arbitrary property name, and
`GoogleRuleSet_NestedRule.required: string[]` doesn't care whether the underlying JSON value the
engine resolves it against was a single object or an array (that normalization happens in
`google-requirements-engine.js`'s `asObjectArray`, not in the type shape) — confirmed by reading
both files, not assumed from the `Product`/`Article` precedent alone.

One decision carried over from `docs/audit-specs/structured-data-remaining-types.md`, restated
here because it's the one place this feature *could* need a type change: `EligibilityRuleSet_TypeRule`
stays `{supported: boolean, richResultFeature: string}`, unchanged. The audit spec's "restricted"
third-state option is **not** adopted in this contract — going with the existing boolean shape
(`FAQPage`/`HowTo` → `supported: false`) keeps this feature data-only. If Gate 1 wants the
three-state schema instead, this contract needs to be redone before `/sequence-tasks` — flagging
explicitly rather than quietly picking one.

## `.lighthouserc.js` config additions

**None.** No new config keys — this feature only adds entries to a new ruleset version file that
the existing `resolveGoogleRequirementsRuleset()`/`resolveEligibilityRuleset()` calls already
resolve via each namespace's `current.json` manifest. Bumping `current.json` to point at the new
version is a data change, not a config-schema change.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a — unchanged |
| lighthouse:all | n/a — unchanged |
| (fork preset) | n/a — unchanged |

**No change from `structured-data-rule-engine`'s contract.** `structured-data-schema-properties` is
not a new audit id here — it already exists, already opt-in-only via `configPath` (confirmed still
true: `packages/utils/test/presets.test.js` would fail if it were added to `recommended.js`/`all.js`,
same reasoning as the parent feature). This feature changes what the audit's ruleset *contains*, not
whether/how it's wired into severity presets. No `.lighthouserc.js` or preset file changes at all.

## Public exports

**None.** No new exports from `packages/seo-audits`. `package.json` is unchanged — no new
dependency (the parent feature's `ajv` pin already covers ruleset-file schema validation for any
number of types; adding rows to an existing JSON file doesn't need a new library).

The only files this feature's implementation touches:
- `packages/seo-audits/rules/google/structured-data/{new-version}.json` (new file, additive —
  10 new type entries, `Product`/`Article` entries carried over unchanged)
- `packages/seo-audits/rules/eligibility/{new-version}.json` (new file, same pattern)
- `packages/seo-audits/rules/google/structured-data/current.json` (bumped to point at the new
  version)
- `packages/seo-audits/rules/eligibility/current.json` (bumped to point at the new version)
- Test fixtures/unit tests exercising the 10 new types through the existing audit — no test
  *infrastructure* changes, just more cases through the already-established shell-out test pattern
  (`packages/seo-audits/test/audits/structured-data-schema-properties.test.js`).
- `packages/seo-audits/README.md` — short addition listing the newly tracked types.

## Consistency check

Cross-checked against `docs/audit-specs/structured-data-remaining-types.md`:

- The per-type `required`/`nested` table there maps directly onto the existing
  `GoogleRuleSet_TypeRule` shape with no gaps — every row's `nested` entries are single-level,
  matching the engine's one-level-only capability the audit spec already confirmed.
- The audit spec's accepted limitation (`FAQPage.acceptedAnswer.text` not checked) requires no
  type change — it's a data-content limitation (the ruleset simply doesn't list `.text` as a
  checked nested-of-nested path), not a shape the typedefs need to express.
- The audit spec's open question (three-state eligibility schema) is explicitly **not** resolved
  by this contract — see the TypeScript types section above. This is the one place audit-spec and
  contract intentionally leave a decision for Gate 1 rather than the contract silently picking a
  side.
