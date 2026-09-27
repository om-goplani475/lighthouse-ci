# AI Agent Pipeline — Reference

This repo is a fork of Google's [lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci), extended
with a new `packages/seo-audits` package for custom SEO and other audits. New feature work in
`packages/seo-audits` flows through a 10-stage agent pipeline instead of ad-hoc prompting, so every
feature gets a written spec, a reviewed contract, an ordered task list, and a real implementation —
each stage's output is a file on disk, not something held in a conversation.

Full detail for each stage lives in `.ai-agents/agents/{stage}.md`. This file is the map.

## Why file-based handoff

Agent stages do **not** reliably share conversation context — you may run `/intake` today and
`/design-contract` next week in a fresh session. Every stage reads its input from `docs/` or
`.ai-agents/state/`, and writes its output the same way. If something isn't written to a file, the
next stage cannot see it.

## The 10 agents

| # | Agent | Slash command | Model | Reads | Writes |
|---|-------|----------------|-------|-------|--------|
| 00 | Product Intake | `/intake "<request>"` | claude-opus, extended thinking | raw request | `docs/feature-specs/{slug}.md` |
| 01 | Audit & Gatherer Designer | `/design-audit` | claude-opus, extended thinking | feature spec, upstream Lighthouse audit API | `docs/audit-specs/{slug}.md` |
| 02 | Feature Contract Designer | `/design-contract` | claude-opus, extended thinking | feature spec | `docs/feature-contracts/{slug}.md` |
| 03 | Task Sequencer | `/sequence-tasks` | claude-opus, extended thinking | audit spec, feature contract | `docs/task-sequences/{slug}.md`, `.ai-agents/state/current-plan.md` |
| 04 | Implementer | `/implement` | claude-sonnet | task sequence, current plan | code in `packages/seo-audits`, one commit per task |
| 05 | Fixture Validator | `/validate-fixtures` | claude-sonnet | implemented audit code | mock HTML fixtures + fixture tests |
| 06 | QA Spec Writer | `/write-qa` | claude-sonnet | feature spec, contract, merged diff | `docs/qa/{slug}.md` |
| 07 | Security Reviewer | `/security-review` | claude-opus, extended thinking | merged diff | `.ai-agents/state/security-findings.md` |
| 08 | CI Integration | `/ci-integration` | claude-sonnet | merged diff | GitHub Actions / Docker config, `.ai-agents/state/ci-backlog.md` |
| 09 | Changelog Writer | `/write-changelog` | claude-sonnet | feature spec, merged diff | `.ai-agents/state/changelog-draft.md`, `docs/changelog/{version}.md` |

## Pipeline flow

```
/intake
   │  (Gate 0 review)
   ▼
/design-audit  ──┐
                  ├─ run in parallel, both feed Gate 1
/design-contract ─┘
   │  (Gate 1 review)
   ▼
/sequence-tasks
   │  (Gate 2 review)
   ▼
/implement
   │  (CI must be green — Gate 3 review)
   ▼
/validate-fixtures
   │
   ├──────────────┬──────────────┐
   ▼              ▼              ▼
/write-qa   /security-review  /ci-integration   (run in parallel, post-merge)
   │              │              │
   └──────────────┴──────────────┘
                  ▼
          /write-changelog
```

`/validate-fixtures` and `/ci-integration` are advisory-weight, not hard gates — skip them for
trivial changes (pure config, docs-only). Everything else is sequential; don't skip a gate.

## Gates

| Gate | After | Checklist |
|------|-------|-----------|
| Gate 0 | `/intake` | `.ai-agents/gates/gate-0-checklist.md` — is the spec concrete enough to design against? |
| Gate 1 | `/design-audit` + `/design-contract` | `.ai-agents/gates/gate-1-checklist.md` — does the audit design match current upstream Lighthouse APIs, is the contract complete? |
| Gate 2 | `/sequence-tasks` | `.ai-agents/gates/gate-2-checklist.md` — is every task atomic, ordered, and scoped to `packages/seo-audits`? |
| Gate 3 | `/implement` (CI green) | `.ai-agents/gates/gate-3-checklist.md` — tests pass, no scope creep, commit history is clean. |

Gates are manual — you (the developer) read the checklist and the stage's output, then decide
whether to move on. Nothing here auto-approves.

## State files (`.ai-agents/state/`)

| File | Tracks |
|------|--------|
| `current-feature.md` | The feature slug currently in flight, and which stage it's at. |
| `current-plan.md` | The task list from `/sequence-tasks`, with each task's status (`pending`/`complete`) — `/implement` resumes from here if interrupted. |
| `security-findings.md` | Running log of findings from `/security-review`; a `critical` entry blocks the next `/intake` until resolved. |
| `ci-backlog.md` | Advisory CI/build findings from `/ci-integration` that don't block merge. |
| `changelog-draft.md` | Unreleased changelog entries, consolidated at release time. |

## Shared context (`.ai-agents/prompts/`)

Read by the relevant agents on every run — see `.ai-agents/README.md` for which agent reads which.

- `lighthouse-conventions.md` — gatherers, audits, `DetailsType`, LHR schema, custom categories.
- `monorepo-rules.md` — yarn workspaces, lerna, cross-package dependency rules.
- `upstream-sync.md` — how to check your audit/gatherer design against current upstream before building.
- `ci-assertion-presets.md` — `.lighthouserc.js` assertion format and severity levels.
- `security-checklist.md` — SSRF prevention, private-IP blocking, Puppeteer/Chromium sandbox flags.
- `testing-patterns.md` — Jest + static mock HTML fixture conventions used across this repo.
