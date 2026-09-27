# Audit spec: Structured Data (JSON-LD) Validation Audit

- slug: structured-data-validation
- upstream-sync checked against: lighthouse@12.6.1 (installed, matches `packages/utils/package.json`)

## Upstream-sync findings

- No existing gatherer collects `<script type="application/ld+json">` content.
  `node_modules/lighthouse/core/gather/gatherers/scripts.js` (`Scripts`) only captures content via
  the `Debugger.scriptParsed` CDP event, which fires for parsed *executable* JavaScript — a
  `<script type="application/ld+json">` block is never parsed as JS by V8, so it never fires this
  event. `MetaElements` only covers `<meta>` tags. **A new gatherer is required**, confirming the
  feature spec's open question.
- Lighthouse's existing `structured-data` audit id
  (`node_modules/lighthouse/core/audits/seo/manual/structured-data.js`) is a **manual placeholder**
  (extends `ManualAudit`, no `audit()` method, no actual validation) — this feature's audit needs a
  **different id** to avoid colliding with it. Using `structured-data-json-ld`.
- **Extension-point correction**: initially assumed Lighthouse's `plugins` mechanism
  (`lighthouse-plugin-*`) would work. Checked `node_modules/lighthouse/core/config/config-plugin.js`
  directly — `ConfigPlugin.parsePlugin` only accepts `{audits, category, groups}` from a plugin
  module (`assertNoExcessProperties` rejects anything else), and `audits` entries are just
  `{path}` referencing audits that consume **already-gathered** artifacts. Plugins cannot register a
  new gatherer. Since this feature needs one, the plugin mechanism doesn't fit — see Extension point
  below for the correct one.

## Gatherer

- New gatherer: `StructuredDataJsonLd`
- Modeled directly on the core `MetaElements` gatherer
  (`node_modules/lighthouse/core/gather/gatherers/meta-elements.js`): a `BaseGatherer` subclass whose
  `getArtifact` calls `driver.executionContext.evaluate(...)` with a page function that runs
  `document.querySelectorAll('script[type="application/ld+json"]')` and returns, for each match, the
  raw `textContent` string plus `getNodeDetails(node)` (for report node references) — **no parsing in
  the gatherer**. Parsing/validation happens in the audit; the gatherer's job is just to return raw,
  serializable text, per this repo's gatherer convention.
- `supportedModes: ['snapshot', 'navigation']`, matching `MetaElements`.
- Artifact shape: `Array<{content: string, node: LH.Artifacts.NodeDetails}>`.

## Audit

- Audit id: `structured-data-json-ld`
- `requiredArtifacts: ['StructuredDataJsonLd']`
- Scoring function:
  - Zero blocks found → `score: 0` (missing case).
  - For each block: try `JSON.parse(block.content)`.
    - Parse failure → that block is invalid, reason `"Invalid JSON"`.
    - Parses but missing `@context` or `@type` → invalid, reason `"Missing @context or @type"`.
    - Otherwise → valid.
  - Any invalid block → `score: 0`. All valid → `score: 1`.
- `DetailsType`: `table` — one row per block found, columns: `index`, `valid` (boolean), `reason`
  (empty if valid), `snippet` (first ~80 chars of the block's content, for locating it in source).
  This satisfies the feature spec's "report each block individually" requirement.
- `scoreDisplayMode`: default (binary pass/fail), consistent with `meta-description`.

## Category placement

- **New custom category**: `seo-extended`, title "Extended SEO (fork)". Per
  `.ai-agents/prompts/lighthouse-conventions.md`, this fork's additions get their own category rather
  than modifying core `seo` — and since we're using a full custom Config (not the plugin schema),
  we're not forced into a plugin-name-as-category-id like the `plugins` mechanism would require.
- `auditRefs: [{id: 'structured-data-json-ld', weight: 1}]` in the new category.

## Extension point (verified)

Not the `plugins` mechanism (see correction above). Use a **custom Lighthouse config file**,
referenced via `.lighthouserc.js`'s documented `collect.settings.configPath` option
(`docs/configuration.md` confirms this is a real, supported setting; `packages/cli/src/collect/node-runner.js`
passes `settings` straight through to the Lighthouse CLI as flags).

`packages/seo-audits` exports a config module (e.g. `packages/seo-audits/src/lighthouse-config.js`):

```js
module.exports = {
  extends: 'lighthouse:default',
  artifacts: [
    {id: 'StructuredDataJsonLd', gatherer: require.resolve('./gatherers/structured-data-json-ld.js')},
  ],
  audits: [require.resolve('./audits/structured-data-json-ld.js')],
  categories: {
    'seo-extended': {
      title: 'Extended SEO (fork)',
      auditRefs: [{id: 'structured-data-json-ld', weight: 1}],
    },
  },
};
```

Consumers point `.lighthouserc.js` at it:

```js
module.exports = {
  ci: {collect: {settings: {configPath: './packages/seo-audits/src/lighthouse-config.js'}}},
};
```

This is Agent 02's contract to finalize (exact `configPath` resolution relative to a consumer's repo
root needs deciding — this spec only confirms the mechanism, not the packaging detail).

## Resolved for Agent 04

- **`extends` preservation**: `lighthouse-config.js` must keep `extends: 'lighthouse:default'` so
  adding this audit/category is additive on top of Lighthouse's default set, not a replacement of it.
  Agent 04 must add a regression test that asserts the default audits (e.g. `meta-description`,
  `document-title`) are still present in the resolved config/LHR after `configPath` is applied —
  this is the concrete check that would catch a future edit accidentally dropping `extends`.
- **Node-details reuse**: the gatherer's `getNodeDetails` calls must reuse the existing page function
  `MetaElements` uses (`node_modules/lighthouse/core/gather/gatherers/meta-elements.js` imports it
  from `pageFunctions`) — do not write a parallel DOM-node-detail implementation in
  `packages/seo-audits`.
