# Gate 0 — Feature Intake Review

Review after `/intake`, before running `/design-audit` / `/design-contract`.

- [ ] The pass/fail example is concrete — a real page, not an abstract description.
- [ ] It's clear whether a new gatherer is needed, and if so, roughly what data it collects.
- [ ] Scope is bounded — "out of scope" section actually excludes things, not left empty.
- [ ] No open question is load-bearing enough to block design (if it is, resolve it now, before
      Agent 01/02 have to guess).
- [ ] `.ai-agents/state/security-findings.md` has no unresolved `critical` entry blocking new work.

If anything fails: re-run `/intake` with the missing detail, don't proceed to design.
