# `.ai-agents/` index

See `../AGENTS.md` first for the full pipeline map. This file is just the directory index.

- `agents/` — one spec per stage (00–09). Each file is what a slash command reads before acting:
  its job, inputs, outputs, and model/config to use.
- `contracts/` — the fixed schema each stage's output must follow, so the next stage can parse it
  without guessing.
- `gates/` — manual review checklists between stages. You read these, not an agent.
- `prompts/` — shared domain context (Lighthouse conventions, monorepo rules, upstream-sync check,
  CI assertion format, security checklist, testing patterns) that multiple agents read on every run.
- `state/` — small files tracking what's in flight: current feature/plan, security findings, CI
  backlog, changelog draft. Mutated by agents, readable by you at any time.

None of this is enforced by tooling — it's a convention the slash commands and agent specs follow.
If you skip a gate or hand-edit a state file, nothing stops you; you're just trading the safety net
for speed.
