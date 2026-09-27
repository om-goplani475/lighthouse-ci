# Schema — Feature Spec

Written by Agent 00 to `docs/feature-specs/{slug}.md`. Read by Agents 01, 02, 06, 09.

```markdown
# Feature: {Name}

- slug: {kebab-case-slug}
- requested: {date}
- type: new-audit | audit-change | tooling | other

## Summary

One paragraph: what this feature does and why.

## Concrete pass/fail example

A specific example of a page that should pass and one that should fail, in plain language.

## Gatherer needs

- New gatherer required: yes/no
- If yes, what page data it needs to collect: {description}
- If no, which existing gatherer(s) provide the needed data: {list}

## Scope

- Package(s) affected: packages/seo-audits (default; note any exception with justification)
- Out of scope: {explicitly list what this feature does NOT cover, to prevent scope creep later}

## Open questions

Anything not yet resolved that Agent 01/02 need to decide during design.
```
