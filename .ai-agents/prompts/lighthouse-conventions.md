# Lighthouse conventions

Read by Agents 01, 02, 04. Domain reference for how Lighthouse audits/gatherers actually work — so
designs cite real mechanisms instead of guessed ones.

## Gatherers

A gatherer collects raw data from the page during a Lighthouse run (DOM state, network requests, CDP
protocol data). Before designing a new one:

- Check whether an existing gatherer already collects the needed data — duplicating collection is
  wasteful and can produce subtly inconsistent data between two gatherers reading the "same" thing.
- A gatherer's output must be serializable (it crosses the Puppeteer/CDP boundary) — no live DOM
  references or functions in its return value.

## Audits

An audit consumes gatherer output (via `artifacts`) and produces a score (0–1, or `null` if
not-applicable) plus a `details` object of the given `DetailsType` for report rendering.

## `DetailsType`

Pick the type that matches what the report table should show:

- `table` — most common; rows of data with defined column headings.
- `list` — simple list items, no columns.
- `debugdata` — internal-only data, not rendered in the report UI (useful for diagnostics without
  cluttering the visible report).
- `opportunity` — for audits framed as "you could save N ms/bytes by doing X."

## Categories

Audits are grouped into categories (Performance, Accessibility, SEO, etc.), each with weighted
audits summing to the category score. A new custom category needs: an id, a title, and a list of
`{id, weight}` audit refs. Don't add a new audit to an existing upstream category unless the feature
spec explicitly calls for altering that category's meaning — prefer a new category for this fork's
additions, since altering an existing category's composition changes what every existing user's
`lighthouse:recommended`-based assertions mean.

## Extension point: `configPath`, not `plugins`

If a new audit needs a **new gatherer**, use a custom Lighthouse config referenced via
`.lighthouserc.js`'s `configPath` setting — not Lighthouse's `plugins` mechanism
(`lighthouse-plugin-*`). Verified directly against `node_modules/lighthouse/core/config/config-plugin.js`:
`ConfigPlugin.parsePlugin` only accepts `{audits, category, groups}` from a plugin module — it cannot
register a new `artifacts` entry (i.e. a new gatherer), only audits that consume artifacts Lighthouse
already gathers. `plugins` is the right choice only for an audit that needs no new gatherer at all;
almost every genuinely new SEO check in this package will need one (Lighthouse's default gatherers
cover a fixed, closed set — check `node_modules/lighthouse/core/gather/gatherers/` before assuming
otherwise).

A `configPath` config module: `{extends: 'lighthouse:default', artifacts: [...], audits: [...],
categories: {...}}`. `extends` must be kept — omitting it replaces Lighthouse's entire default
audit/category set instead of adding to it. Paths inside this file are plain relative strings, not
`require.resolve()` — Lighthouse's own `resolveModulePath` (`config-helpers.js`) resolves them against
the config file's own directory natively. `require.resolve()` also wouldn't work here regardless,
since `packages/seo-audits` is ESM (see below) — no bare `require` available.

When testing a `configPath`-based config's resolution directly (e.g. with `initializeConfig` from
`lighthouse/core/config/config.js`), pass `{configPath: <absolute path to the config file>}` as the
third argument — `configDir` (needed to resolve the `artifacts`/`audits` relative paths) comes from
that flag, not from wherever the config object was imported from. Passing just the imported config
object without `configPath` in flags will fail to resolve any relative gatherer/audit path.

## Module format: `packages/seo-audits` is ESM

Every other package in this monorepo (`@lhci/cli`, `@lhci/utils`) is CommonJS. `packages/seo-audits`
is deliberately ESM (`"type": "module"` in its `package.json`) because Lighthouse itself is ESM and
loads custom `configPath`/audit/gatherer files via dynamic `import()`
(`config-helpers.js`'s `requireWrapper`), and its own `Audit`/`BaseGatherer` base classes are ESM
`export default`. New files in this package should follow that — `import`/`export`, not
`require`/`module.exports`. The root `.eslintrc.js` has an `overrides` entry scoping
`sourceType: 'module'` to `packages/seo-audits/**/*.js` already; no further lint config needed for new
files in this package.

One caveat specific to Jest: importing the real `lighthouse` package directly inside a Jest test hits
`import.meta` in a file Jest's transform won't touch (`transformIgnorePatterns` doesn't fully solve
it). `packages/utils/test/presets.test.js` already worked around this by shelling out to
`node --input-type=module -e "..."` instead of importing `lighthouse` in-process — follow that same
pattern for any test that needs to exercise real Lighthouse config resolution (see
`packages/seo-audits/test/lighthouse-config.test.js` for a worked example).

**This also applies to `packages/seo-audits/src/rule-engine/registry.js` itself** (added by the
`structured-data-rule-engine` feature) — it uses `import.meta.url` at module scope to locate
`rules/`. This is a compile-time constraint, not a runtime one: TypeScript cannot emit `import.meta`
under this repo's shared `module: "commonjs"` tsconfig, so ts-jest's transform fails on
`registry.js`'s source itself. **Any audit file that imports `registry.js`, even transitively
(directly, or via a rule-engine module that imports it), can never be loaded with a plain top-level
Jest `import` — the whole module fails to parse.** Use the same shell-out pattern for its tests, but
go one step further than `lighthouse-config.test.js`'s inline `-e` string: write the artifacts/args to
temp files and run a small driver script file instead of interpolating JSON into a shell string
directly — JSON containing quotes (e.g. a malformed-JSON test fixture) does not survive multi-layer
shell/JS string escaping reliably. See `packages/seo-audits/test/audits/structured-data-json-ld.test.js`
or `structured-data-schema-properties.test.js` for the worked pattern (`fs.mkdtempSync` + a small
`.mjs` driver script + `execFile`, no shell string interpolation of data).

## TypeScript boundary: closed `Artifacts`/`GathererArtifacts` types

A custom gatherer's `getArtifact` return type and a custom audit's `requiredArtifacts`/`artifacts`
param will **not** structurally satisfy `BaseGatherer`/`Audit`'s real signatures, because Lighthouse's
own `Artifacts`/`GathererArtifacts` types (`lighthouse/types/artifacts.d.ts`) are a closed union of
its own known artifact names — a third-party artifact contributed by an out-of-tree package can never
be a member of that type. This is expected, not a bug to chase down. The fix is a documented
`@ts-expect-error` at the point of structural mismatch (the class declaration for a gatherer's
`getArtifact` override, and separately at the class declaration *and* the `requiredArtifacts` array
literal for an audit — TypeScript anchors these at different lines; check the actual error location
rather than guessing), each explaining why. See `packages/seo-audits/src/gatherers/structured-data-json-ld.js`
and `packages/seo-audits/src/audits/structured-data-json-ld.js` for the exact pattern to copy.

Do **not** fix this by augmenting Lighthouse's own ambient types from this package (e.g.
`declare module 'lighthouse/types/artifacts.js' { interface GathererArtifacts {...} }`) — that means
patching upstream's types from a consumer, which defeats the point of depending on upstream as a
library (Option B) rather than editing its internals.

Also note: this repo's own `LH` global namespace (`types/lighthouse.d.ts`) is **not** the same as
Lighthouse's internal ambient types (`LH.Artifacts`, `LH.Gatherer`, `LH.Audit`, `LH.Config` don't
resolve through it — `node_modules` isn't in this repo's `tsconfig.json` program). Reference
Lighthouse's own types explicitly instead: `import('lighthouse/types/audit.js').default.Meta`,
`import('lighthouse/types/gatherer.js').default.Context`, `import('lighthouse/types/config.js').default`,
etc.

## JSDoc comments mentioning `@type`/`@context` in prose

Easy to hit repeatedly in this package specifically, since its whole subject is JSON-LD's `@type`
and `@context` keys: writing them as plain prose inside a `/** ... */` block comment (e.g. "checks
the @type field") gets misparsed by TypeScript's JSDoc tag scanner as an actual `@type {...}` tag,
producing confusing "Cannot find name" / "Type expected" errors pointing at unrelated-looking code.
Reword to avoid the bare `@` — e.g. "the schema type" instead of "the `@type`", or "JSON-LD's type
and context keys" instead of "`@type`/`@context`" — rather than fighting the parser.

## LHR (Lighthouse Result)

The full report JSON. Audit results live under `lhr.audits[auditId]`. Category scores live under
`lhr.categories[categoryId]`. This shape is what `packages/server` stores and `packages/viewer`
renders — any change to it downstream of an audit change needs both of those checked, not just the
audit's own test.

## Where this can drift from what's installed

This file describes the mechanism as of when it was written. Lighthouse's actual API can change
between versions — see `upstream-sync.md` for the check that catches that before you design against
a stale assumption.

## Audit ids: no hyphen followed by a digit

Never give an audit an id containing a hyphen followed by a digit (`soft-404`, `h1-count` is fine,
`h-1` is not). `lhci assert` expands every hyphenated assertion key into a camelCase alias and discards
the alias by comparing it with a kebab-case conversion that inserts no hyphen before digits, so for
`soft-404` the alias `soft404` survives and is asserted as an unknown audit: every `lhci assert` run
fails with "`soft404` is not a known audit", whatever the real audit scored. Found in live QA for
Phase 5's soft-404 check, which is why that audit is `soft-not-found`. `test/lighthouse-config.test.js`
fails on any registered id that matches `/-\d/`.
