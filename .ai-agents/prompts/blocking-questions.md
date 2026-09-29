# Blocking questions

Read by Agents 00, 01, 02, and 03 — the design-time stages, where scope/architecture decisions with
more than one reasonable answer actually come up.

## The rule

If, while doing your stage's work, you hit a decision that genuinely has more than one reasonable
answer and the choice would change what gets built (not just how it's documented), **ask the
developer before writing your output file, using an interactive blocking question** — don't pick an
answer yourself and only mention it in the spec's prose, and don't defer it to "Gate N review" and
hope the developer reads closely enough to catch it.

This replaced an earlier pattern where open questions were written into the output doc's "Open
questions" section with a recommended answer, and only surfaced to the developer as a line in the
stage's closing summary. That pattern is unreliable — it depends on the developer reading every
summary closely, and at least one real feature shipped a decision (an audit's assertion-severity
guidance) that later turned out to need correcting specifically because it was made unilaterally at
design time instead of confirmed with the developer first.

## What counts as blocking

Ask, don't decide silently, when:

- The choice changes what code gets written, not just how a doc describes it (e.g. "build this as a
  new audit, or close the roadmap item as already-covered by existing data" — a real example from
  this pipeline's own history).
- Two defensible options exist and picking wrong means rework, not just a documentation fix.
- The developer stated a preference earlier that this decision might override, and you're not sure
  it still applies.

Don't ask about things with only one reasonable answer, or pure implementation detail that later
stages (Agent 04) will work out anyway — that's what "don't ask about implementation detail" in
Agent 00's Step 2 already means, and it still applies. The bar is "more than one reasonable answer
that changes the build," not "any decision at all."

## How to ask

Use the interactive question tool available in this environment, not a written "Open questions"
section alone. If there are multiple related decisions, ask them together in one batch rather than
one at a time. State your recommended answer as one of the options, marked as recommended, so the
developer can accept it with one click if they agree — this is about getting an explicit answer
promptly, not about making the developer do the design work themselves.

Once answered, record the decision and who/when it was made in the output doc (e.g. "Decided at Gate
0 (2026-09-29): build it.") — the doc is still the durable record; the question is just how you get
to that record instead of guessing.

## What if you can't ask (no interactive session, running unattended)

If this stage is running somewhere a blocking question can't be answered synchronously, write the
question into the output doc's "Open questions" section exactly as before, but also refuse to let
the *next* stage proceed past a documented-but-unanswered blocking question — Gate review should
fail closed on an unresolved one, not treat it as optional polish.
