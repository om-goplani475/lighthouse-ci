# /write-changelog

Run Agent 09 — Changelog Writer.

Writes user-facing and internal changelog entries for the merged feature.

## Usage

```
/write-changelog
```

Run after `/validate-fixtures`, `/write-qa`, `/security-review`, and `/ci-integration` (if run) have
all completed.

For a release cut bundling multiple features:
```
/write-changelog --release
```

## What it does

**Single-feature mode:**
1. Reads `docs/feature-specs/{slug}.md` and the closed PR description.
2. Writes user-facing and internal entries.
3. Appends to `.ai-agents/state/changelog-draft.md` under `## Unreleased`.
4. Opens an auto-merge PR.

**Release mode (`--release`):**
1. Reads all unreleased entries from `.ai-agents/state/changelog-draft.md`.
2. Determines the version bump for this fork.
3. Writes `docs/changelog/{version}.md`.
4. Clears `## Unreleased`.
