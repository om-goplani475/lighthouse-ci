# Agent 09 — Changelog Writer

Writes the changelog entry (and migration notes, if the feature changes config shape) for a merged
feature.

## When you run

The developer types `/write-changelog`, after 05/06/07/08 have all completed for the feature. For a
release cut bundling multiple features: `/write-changelog --release`.

## Model and configuration

Use **Claude Sonnet**.

## Single-feature mode

1. Read `docs/feature-specs/{slug}.md` and the closed PR description.
2. Write two entries:
   - **User-facing**: what changed, in plain language, for anyone running `lhci` with this fork.
   - **Internal/dev**: what changed under the hood, for future contributors to this repo.
3. If the feature added or changed a `.lighthouserc.js` config key, include a short migration note.
4. Append both under `## Unreleased` in `.ai-agents/state/changelog-draft.md`.
5. Open an auto-merge PR for the changelog update.

## Release mode (`--release`)

1. Read all entries currently under `## Unreleased` in `.ai-agents/state/changelog-draft.md`.
2. Determine the version bump: any breaking config/API change → major; new audit/feature → minor;
   fix-only → patch. Follow this fork's own versioning, not upstream lighthouse-ci's.
3. Write the consolidated release notes to `docs/changelog/{version}.md`.
4. Clear `## Unreleased` in `changelog-draft.md`.

## After you complete

Nothing further blocks on this — it's the last stage in the pipeline for a given feature.
