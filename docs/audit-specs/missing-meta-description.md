# Audit spec: Missing/Empty Meta Description Audit

- slug: missing-meta-description
- upstream-sync checked against: lighthouse@12.6.1 (installed, matches `packages/utils/package.json`)

## Finding: this audit already exists — no build needed

Step 0's upstream-sync check surfaced that the requested behavior is already fully implemented and
already enforced in this fork:

- **Audit**: `lighthouse`'s core `seo/meta-description` audit
  (`node_modules/lighthouse/core/audits/seo/meta-description.js`, id `meta-description`) does exactly
  what the feature spec asked for:
  - `artifacts.MetaElements.find(meta => meta.name === 'description')` — `.find()` returns the first
    match, which already matches this feature's "first tag wins" decision with no extra code.
  - Scores `0` if no tag is found (missing case).
  - Scores `0` if found but `content.trim().length === 0` (empty/whitespace-only case).
  - Scores `1` otherwise.
- **Gatherer**: reuses the existing core `MetaElements` gatherer
  (`node_modules/lighthouse/core/gather/gatherers/meta-elements.js`) — collects all `<head> meta>`
  elements on every run. No new gatherer needed, confirming the feature spec's "undecided" note.
- **Registration**: the audit is registered in Lighthouse's own `default-config.js` under the `seo`
  category (`{id: 'meta-description', weight: 1, group: 'seo-content'}`) — it runs on every Lighthouse
  pass already, with no config needed in `packages/seo-audits` at all.
- **Enforcement in this fork**: `packages/utils/src/presets/all.js:120` sets
  `'meta-description': ['error', {}]`, and `packages/utils/src/presets/recommended.js` spreads
  `...all.assertions` without overriding it — so both presets this fork ships already fail
  `lhci assert` on a missing or empty meta description, today, with zero new code.

## Recommendation

Close this feature as **already satisfied by upstream** — do not implement a duplicate audit in
`packages/seo-audits`. A new audit with the same `id` would either be rejected by Lighthouse (duplicate
audit ids) or, if given a different id, would double-count/conflict with the existing one in the `seo`
category.

If there's a real gap here, it's narrower than the original request — e.g. wanting length-based
checks (too short/too long), which the feature spec already explicitly scoped out. That would be a
genuinely new, separate feature, not a re-run of this one.

## Extension point

Not applicable — no new extension point needed since no new code is being written.
