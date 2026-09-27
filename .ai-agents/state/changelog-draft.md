# Changelog draft

## Unreleased

### structured-data-validation (2026-09-27)

**User-facing**: Added a new opt-in audit, `structured-data-json-ld`, via the new `@lhci/seo-audits`
package. It checks every `<script type="application/ld+json">` block on a page for valid JSON and
the required `@context`/`@type` fields — something Lighthouse's own built-in `structured-data` audit
does not do (it's a manual placeholder that just tells you to run an external tool). To use it, point
your `.lighthouserc.js` at `require.resolve('@lhci/seo-audits/lighthouse-config.js')` via
`collect.settings.configPath` — see `packages/seo-audits/README.md` for the full setup, including how
to set your own assertion severity (this audit is not part of the `recommended`/`all` presets, since
it's opt-in and not one of Lighthouse's own default audits).

**Internal/dev**: New workspace package `packages/seo-audits` (`@lhci/seo-audits`), the first
fork-specific addition to this repo and the first ESM package alongside the existing CommonJS ones —
required because Lighthouse loads custom `configPath`/audit/gatherer files via dynamic `import()` and
its own base classes are ESM. Added a scoped ESLint `overrides` entry for
`packages/seo-audits/**/*.js` (`sourceType: 'module'`, `strict` off) rather than changing the global
lint config. Built through the `.ai-agents/` pipeline end-to-end (docs at
`docs/feature-specs/structured-data-validation.md` and sibling `docs/audit-specs/`,
`docs/feature-contracts/`, `docs/task-sequences/`, `docs/qa/` files) — first real run of the pipeline,
which caught one dead-end feature request already satisfied by upstream (`missing-meta-description`)
before this one, and one design correction mid-flight (plugin mechanism vs. custom `configPath`, since
Lighthouse plugins can't register new gatherers).

No migration note needed — no existing `.lighthouserc.js` config key was added or changed; this
feature is entirely opt-in via Lighthouse's own pre-existing `configPath` setting.

<!-- Appended by Agent 09 after each feature. Cleared into docs/changelog/{version}.md on a
/write-changelog --release run. -->
