# Feature contract: Structured Data (JSON-LD) Validation Audit

- slug: structured-data-validation

## TypeScript types

**Correction (caught at `/sequence-tasks`, before implementation)**: originally written as
`packages/seo-audits/src/types.ts` with TS `export interface` syntax. That matches neither this
repo's actual convention nor its build. Checked directly: `packages/utils/src/audit-diff-finder.js`
uses plain `.js` with JSDoc `@typedef` comments and `module.exports` (CommonJS), and root
`tsconfig.json`'s `include` only globs `packages/*/src/**/*.js` and `.jsx` — a `.ts` file under
`packages/*/src` would never even be picked up by `npm run test:typecheck`. Corrected below.

**Module format note**: this also interacts with a second, separate constraint — `lighthouse` itself
is `"type": "module"` (ESM) and loads custom `configPath`/audit/gatherer files via dynamic `import()`
(`node_modules/lighthouse/core/config/config-helpers.js:230`), and its own `Audit`/`BaseGatherer`
base classes are ESM `export default`. Sibling packages (`@lhci/cli`, `@lhci/utils`) are CommonJS
(no `"type": "module"`, confirmed in their `package.json`). So `packages/seo-audits` needs
`"type": "module"` in its own `package.json` — its files are ESM, consistent with the Lighthouse
classes it extends, independent of its CJS siblings. `require.resolve()` (used elsewhere in this
contract for `configPath`) still works fine across this boundary since it only resolves a file path,
it doesn't load/execute the module.

```js
// packages/seo-audits/src/types.js — plain JS, JSDoc typedefs, ESM export (per "type": "module")

/**
 * Raw artifact returned by the StructuredDataJsonLd gatherer — one entry per
 * <script type="application/ld+json"> block found on the page. No parsing here;
 * parsing/validation happens in the audit.
 * @typedef {{content: string, node: LH.Artifacts.NodeDetails}} StructuredDataJsonLdEntry
 */

/** @typedef {StructuredDataJsonLdEntry[]} StructuredDataJsonLdArtifact */

/**
 * One row of the audit's details table — one per block found.
 * @typedef {{index: number, valid: boolean, reason: string, snippet: string}} StructuredDataBlockResult
 */

export {};
```

Consumed elsewhere via `/** @type {import('./types.js').StructuredDataJsonLdEntry} */`. These match
`docs/audit-specs/structured-data-validation.md`'s gatherer artifact shape (`Array<{content, node}>`)
and the audit's details table columns (`index, valid, reason, snippet`) exactly.

## `.lighthouserc.js` config additions

**No new bespoke config keys.** This feature doesn't invent its own config schema — it's consumed
entirely through Lighthouse's own native `configPath` setting (already a first-class,
documented Lighthouse setting; see `docs/configuration.md`), pointed at the config module
`packages/seo-audits` exports. There is nothing for `packages/utils`'s `.lighthouserc.js` parser to
learn — it already passes `collect.settings` straight through untouched.

Consumer usage:

```js
// consumer's .lighthouserc.js
module.exports = {
  ci: {
    collect: {
      settings: {
        // NOT a relative string — configPath resolves against process.cwd()
        // (node_modules/lighthouse/cli/bin.js:70), which varies by where `lhci`
        // is invoked from. require.resolve against the package name is
        // cwd-independent and correct regardless of caller location.
        configPath: require.resolve('@lhci/seo-audits/lighthouse-config.js'),
      },
    },
  },
};
```

## Assertion presets

| Preset | Severity | Why |
|--------|----------|-----|
| `lighthouse:recommended` | `warn` | Per `.ai-agents/prompts/ci-assertion-presets.md`'s default rule: new audits default to `warn` in `recommended` unless the spec explicitly calls for `error`. Malformed structured data is a real signal but not zero-false-positive across all deployments (e.g. a page mid-migration); conservative default. |
| `lighthouse:all` | `error` | Matches this preset's existing convention — every audit at `error` (see `meta-description` at `packages/utils/src/presets/all.js:120`). |
| Fork-specific `seo-strict` preset | Not applicable — no such preset exists in this fork today (checked `packages/utils/src/presets/`: only `no-pwa.js`, `recommended.js`, `all.js`). Not introducing one for this feature; out of scope. |

Concrete assertion line for `all.js` (inherited unmodified by `recommended.js` via its
`...all.assertions` spread, then overridden to `warn` there — see edits below):

```js
// packages/utils/src/presets/all.js
'structured-data-json-ld': ['error', {}],
```

```js
// packages/utils/src/presets/recommended.js — add to the overrides list
'structured-data-json-ld': ['warn', {}],
```

**Important scope note for Gate 2/Agent 03**: editing `packages/utils/src/presets/all.js` and
`recommended.js` touches files *outside* `packages/seo-audits`. Per `.ai-agents/prompts/monorepo-rules.md`,
this must be flagged as a higher-risk task, not silently included. It's necessary here only because
this fork's own default presets are meant to cover its own added audits — but only fires for
consumers who actually opt into `configPath`, so it's inert for anyone who doesn't. Flagging, not
blocking: this is a deliberate, narrow, justified exception (one line added to each of two files,
not a structural change), matching the "rare and explicit" bar `monorepo-rules.md` sets.

## Public exports

`packages/seo-audits/package.json`:

```json
{
  "name": "@lhci/seo-audits",
  "version": "0.1.0",
  "type": "module",
  "main": "src/lighthouse-config.js"
}
```

Exposes (all under `packages/seo-audits/src/`):

- `lighthouse-config.js` — the custom Lighthouse config module (per
  `docs/audit-specs/structured-data-validation.md`'s Extension point section), resolved by consumers
  via `require.resolve('@lhci/seo-audits/lighthouse-config.js')`.
- `gatherers/structured-data-json-ld.js` — the gatherer, referenced from `lighthouse-config.js` via
  `require.resolve('./gatherers/structured-data-json-ld.js')` (already resolves correctly relative to
  the config module's own location, not `process.cwd()` — gatherer/audit paths inside a Lighthouse
  config are resolved differently than `configPath` itself; confirm this in Agent 04's implementation
  against `node_modules/lighthouse/core/config/config-helpers.js`'s `resolveModulePath` before relying
  on it blindly).
- `audits/structured-data-json-ld.js` — the audit.
- `types.ts` — the TypeScript types above, for this package's own internal use and tests. Not
  required by Lighthouse's runtime (which doesn't care about TS types), but keeps `packages/seo-audits`
  typechecked under this repo's root `tsc -p .`.

**No import from `packages/cli` needed.** Per `monorepo-rules.md`, `seo-audits` is a leaf package
consumed only through the `configPath` file reference at run time — `packages/cli` never imports
`@lhci/seo-audits` in code, matching Option B's original goal of keeping this fork's additions out of
Google's original package boundaries.

## Consistency check

Cross-checked against `docs/audit-specs/structured-data-validation.md`:

- Gatherer artifact shape matches exactly (`StructuredDataJsonLdArtifact` ≡ audit spec's
  `Array<{content, node}>`).
- Audit details table columns match exactly (`StructuredDataBlockResult` ≡ audit spec's `index,
  valid, reason, snippet`).
- Audit id `structured-data-json-ld` used consistently in assertion presets, category `auditRefs`,
  and `requiredArtifacts` references.
- Resolved the audit spec's one open item ("exact `configPath` resolution... needs deciding") —
  answered above: `require.resolve()` against the `@lhci/seo-audits` package name, not a relative
  string, because `configPath` resolves against `process.cwd()`.
