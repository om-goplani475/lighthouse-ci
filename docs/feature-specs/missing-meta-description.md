# Feature: Missing/Empty Meta Description Audit

- slug: missing-meta-description
- requested: 2026-09-27
- type: new-audit

## Summary

A new SEO audit in `packages/seo-audits` that flags pages with no `<meta name="description">` tag,
or one whose `content` attribute is empty or whitespace-only. Length-based checks (too short/too
long) and duplicate-description-across-pages checks are explicitly out of scope for this feature —
see below.

## Concrete pass/fail example

- **Pass**: page has `<meta name="description" content="Buy running shoes online with free returns.">`
  — non-empty, trimmed content present.
- **Fail (missing)**: page has no `<meta name="description">` tag anywhere in `<head>`.
- **Fail (empty)**: page has `<meta name="description" content="">` or
  `<meta name="description" content="   ">` (whitespace only after trimming).

## Gatherer needs

- New gatherer required: **undecided — left for Agent 01 to determine** during the upstream-sync
  check in `/design-audit`. Lighthouse's core meta-elements gatherer likely already collects this
  data; Agent 01 should confirm against the currently installed `lighthouse` version rather than
  assume.

## Scope

- Package(s) affected: `packages/seo-audits`
- Out of scope (explicitly, not just unmentioned):
  - Length-based flags (too short / too long content) — a separate future feature, since it needs a
    judgment call on thresholds this request didn't make.
  - Duplicate meta descriptions across multiple pages of the same site — this needs cross-page data
    a single-page audit doesn't have; would require a different mechanism (e.g. comparing against
    `packages/server`-stored history), not just a Lighthouse audit.
  - Multiple `<meta name="description">` tags on one page — resolved below, not out of scope.

## Open questions

None remaining. Resolved:

- **Multiple `<meta name="description">` tags on one page**: the audit checks the first tag only,
  matching browser/crawler behavior of using the first occurrence. Decided 2026-09-27, for this
  feature.
