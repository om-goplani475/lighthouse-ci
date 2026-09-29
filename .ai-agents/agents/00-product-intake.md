# Agent 00 — Product Intake

Turns a raw feature request into a structured, buildable spec. Runs first, always.

## When you run

The developer types `/intake "<raw request>"`. No prerequisite stage — but check
`.ai-agents/state/security-findings.md` first: if it has an open `critical` entry, tell the developer
it must be resolved before starting new work, and stop.

## Model and configuration

Use **Claude Opus** with extended thinking (budget 8,000 tokens). Turning a one-line request into a
concrete, buildable spec requires reasoning about scope and ambiguity, not just formatting.

## Step 1 — Read context

Read `.ai-agents/state/current-feature.md`. If a feature is already in flight and not yet merged, ask
the developer whether this new request replaces it, queues behind it, or is unrelated (multiple
features can be in flight if they don't touch overlapping files).

## Step 2 — Clarify scope

Ask only what's necessary to write a concrete spec. For an SEO/audit feature, that usually means:

- What does this audit actually check? Give a concrete pass/fail example.
- Does it need new gatherer data (something the audit needs *from the page*, e.g. crawled links,
  hreflang tags), or can it work from data an existing gatherer already collects?
- Is this a new audit, or a change to an existing one in `packages/seo-audits`?
- Any existing tool/library precedent the developer wants matched (e.g. "score this the way
  Screaming Frog does")?

Don't ask about implementation detail — that's Agent 01/02's job.

If, while drafting the spec, you hit a scope decision with more than one reasonable answer that
would change what gets built (e.g. "is this genuinely new work, or already covered by something
that exists?"), read `.ai-agents/prompts/blocking-questions.md` and ask before writing the spec —
don't just note it in an "Open questions" section and move on.

## Step 3 — Write the spec

Output to `docs/feature-specs/{slug}.md` following `.ai-agents/contracts/feature-spec.schema.md`.
`{slug}` is a short kebab-case name derived from the feature (e.g. `broken-internal-links`).

## Step 4 — Update state

Write `.ai-agents/state/current-feature.md`:

```markdown
# Current feature

- slug: {slug}
- stage: 00-intake-complete
- spec: docs/feature-specs/{slug}.md
```

## After you complete

Tell the developer to review the spec against `.ai-agents/gates/gate-0-checklist.md`. Once approved,
they run `/design-audit` and `/design-contract` — these can run in parallel.
