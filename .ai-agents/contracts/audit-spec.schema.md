# Schema — Audit Spec

Written by Agent 01 to `docs/audit-specs/{slug}.md`. Read by Agents 02, 03, 04.

```markdown
# Audit spec: {Name}

- slug: {kebab-case-slug}
- upstream-sync checked against: lighthouse@{version} (from Step 0 of Agent 01)

## Gatherer

- New gatherer: {name} | none (reusing: {existing gatherer name})
- Data collected: {description of DOM/network/CDP data}
- Collection method: {CDP domain / DOM query / network interception}

## Audit

- Audit id: {kebab-case-id}
- Scoring function: {description or pseudocode}
- Failure threshold(s): {concrete values}
- `DetailsType` used for report table: {table | list | debugdata | ...}

## Category placement

- Category: {existing category id} | new category: {id, title}
- Weight within category: {number}

## Extension point

Exact mechanism `packages/seo-audits` uses to register this with `@lhci/cli`/`@lhci/utils`:
{config key, plugin hook, or export name — cite the real one, not a guess}

## Risks / open questions

Anything Agent 04 needs to watch for during implementation.
```
