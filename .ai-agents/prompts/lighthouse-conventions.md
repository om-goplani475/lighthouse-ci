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

## LHR (Lighthouse Result)

The full report JSON. Audit results live under `lhr.audits[auditId]`. Category scores live under
`lhr.categories[categoryId]`. This shape is what `packages/server` stores and `packages/viewer`
renders — any change to it downstream of an audit change needs both of those checked, not just the
audit's own test.

## Where this can drift from what's installed

This file describes the mechanism as of when it was written. Lighthouse's actual API can change
between versions — see `upstream-sync.md` for the check that catches that before you design against
a stale assumption.
