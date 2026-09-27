# CI assertion presets

Read by Agent 02. Format for `.lighthouserc.js` assertions and severity levels in this repo.

## Format

```js
module.exports = {
  ci: {
    assert: {
      preset: 'lighthouse:recommended',
      assertions: {
        'my-audit-id': ['error', {minScore: 0.9}],
      },
    },
  },
};
```

## Severity levels

- `error` — fails `lhci assert` / CI. Use for audits with a clear, unambiguous fail condition and low
  false-positive risk.
- `warn` — reported but doesn't fail CI. Use for audits still being tuned, or with legitimate
  page-specific exceptions the preset can't know about.
- `off` — not evaluated in this preset. Use when an audit isn't relevant to the preset's scope.

## Presets in this repo

- `lighthouse:recommended` — upstream default; a new audit should default to `warn` here unless the
  feature spec explicitly calls for `error` (be conservative — this preset is what most consumers of
  this fork will use out of the box).
- `lighthouse:all` — every audit at `error`; used for exhaustive local checks, not typical CI.
- A fork-specific preset (if `packages/seo-audits` defines one, e.g. `lighthouse:seo-strict`) — new
  SEO audits can default to `error` here, since anyone opting into this preset wants strictness.

## Choosing a threshold

State the concrete `minScore` (or equivalent) in the feature contract, not "a reasonable value" —
Agent 04 needs a literal number to implement against, and Gate 1 needs one to review.
