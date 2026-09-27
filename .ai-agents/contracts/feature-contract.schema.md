# Schema — Feature Contract

Written by Agent 02 to `docs/feature-contracts/{slug}.md`. Read by Agents 03, 04, 06.

```markdown
# Feature contract: {Name}

- slug: {kebab-case-slug}

## TypeScript types

```ts
// exact interfaces/types this feature introduces in packages/seo-audits
```

## `.lighthouserc.js` config additions

```js
// new config keys, with default values, and where they're read in packages/seo-audits
```

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | error / warn / off |
| lighthouse:all | error / warn / off |
| (this fork's preset, if any) | error / warn / off |

## Public exports

What `packages/seo-audits` exports, and how `packages/cli` consumes it (exact import path / config
wiring).

## Consistency check

Confirm these types match `docs/audit-specs/{slug}.md`'s audit output shape — note explicitly if
`/design-audit` hasn't completed yet and this is provisional.
```
