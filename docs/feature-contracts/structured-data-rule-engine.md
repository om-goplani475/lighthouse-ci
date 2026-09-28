# Feature contract: Structured Data Rule Engine

- slug: structured-data-rule-engine

## TypeScript types (JSDoc typedefs, plain `.js`, per this repo's actual convention — not `.ts`,
same correction made for `structured-data-validation`'s contract)

```js
// packages/seo-audits/src/rule-engine/types.js

/**
 * @typedef {'schema-org' | 'google-requirements' | 'eligibility'} FindingNamespace
 * @typedef {'error' | 'info'} FindingSeverity
 */

/**
 * @typedef {{
 *   namespace: FindingNamespace,
 *   type: string,
 *   property: string,
 *   severity: FindingSeverity,
 *   message: string,
 * }} Finding
 */

/** @typedef {{required: string[]}} SchemaOrgRuleSet_Universal */
/** @typedef {{version: string, universal: SchemaOrgRuleSet_Universal, types: object}} SchemaOrgRuleSet */

/** @typedef {{type: string, required: string[]}} GoogleRuleSet_NestedRule */
/**
 * @typedef {{
 *   required: string[],
 *   nested: Record<string, GoogleRuleSet_NestedRule>,
 *   conditional: Array<{if: object, then: object}>,
 * }} GoogleRuleSet_TypeRule
 */
/** @typedef {{version: string, types: Record<string, GoogleRuleSet_TypeRule>}} GoogleRequirementsRuleSet */

/** @typedef {{supported: boolean, richResultFeature: string}} EligibilityRuleSet_TypeRule */
/** @typedef {{version: string, types: Record<string, EligibilityRuleSet_TypeRule>}} EligibilityRuleSet */

export {};
```

Matches `docs/audit-specs/structured-data-rule-engine.md`'s engine/ruleset shapes exactly —
`google-requirements-engine.js`'s `nested`/`conditional` handling, `eligibility-engine.js`'s
`supported`/`richResultFeature` lookup, and `schema-org-engine.js`'s flat `universal.required` check
all map directly to these typedefs.

## `.lighthouserc.js` config additions

**None.** Same as `structured-data-validation` — this feature rides entirely on the existing
`configPath` mechanism already wired up in `packages/seo-audits/src/lighthouse-config.js`. No new
config schema for `packages/utils` to learn.

## Assertion presets

**Neither audit gets added to `all.js`/`recommended.js`.** Proactively documenting this now instead
of discovering it during implementation (which is what happened for `structured-data-json-ld` last
time): `packages/utils/test/presets.test.js` asserts every preset-referenced audit id is one of
Lighthouse's own default audits. Both `structured-data-json-ld` (already) and
`structured-data-schema-properties` (new) are opt-in via `configPath`, never part of Lighthouse's
default config — adding either to the shared presets would fail that test, exactly as it did before.
Severity for `structured-data-schema-properties` is the consumer's own choice in their own
`.lighthouserc.js`, same pattern as `structured-data-json-ld` — see `packages/seo-audits/README.md`,
which needs a short addition documenting the new audit alongside the existing one.

## Public exports

`packages/seo-audits/package.json` gains an explicit `ajv` dependency (`^6.12.6`, matching the
version already resolvable in this repo's `node_modules` — not a newer major version, per the audit
spec's note on avoiding an unrelated dependency bump).

No new top-level package exports beyond what already exists (`main: src/lighthouse-config.js`) — the
rule-engine modules (`src/rule-engine/*.js`) and the new audit (`src/audits/structured-data-schema-properties.js`)
are internal to the package, wired into `lighthouse-config.js`'s `audits` array and the `seo-extended`
category's `auditRefs`, the same way `structured-data-json-ld` already is. `packages/cli` still never
imports `@lhci/seo-audits` directly — unchanged from the existing pattern.

## Consistency check

Cross-checked against `docs/audit-specs/structured-data-rule-engine.md`:

- `Finding` typedef fields (`namespace, type, property, severity, message`) match the audit spec's
  `structured-data-schema-properties` details-table columns (`blockIndex, type, namespace, property,
  message`) — `blockIndex` is added at the audit layer when formatting findings into the table, not
  part of `Finding` itself (a `Finding` doesn't know which block it came from; the audit loop attaches
  that when building table rows).
- `GoogleRequirementsRuleSet`'s `conditional` field is typed but unused by
  `google-requirements-engine.js` in v1, matching the audit spec's explicit note that it's reserved,
  not evaluated, this feature.
- `EligibilityRuleSet_TypeRule`'s `supported`/`richResultFeature` fields match
  `eligibility-engine.js`'s lookup exactly.
- Resolved the audit spec's `ajv` dependency note into a concrete `package.json` change here.
