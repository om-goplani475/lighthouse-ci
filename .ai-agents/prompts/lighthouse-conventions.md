# Lighthouse conventions

Read by Agents 01, 02, 04. Domain reference for how Lighthouse audits/gatherers actually work — so
designs cite real mechanisms instead of guessed ones.

## Gatherers

A gatherer collects raw data from the page during a Lighthouse run (DOM state, network requests, CDP
protocol data). Before designing a new one:

- Check whether an existing gatherer already collects the needed data — duplicating collection is
  wasteful and can produce subtly inconsistent data between two gatherers reading the "same" thing.
- A gatherer's output must be serializable (it crosses the Puppeteer/CDP boundary) — no live DOM
  references or functions in its return value.

## Audits

An audit consumes gatherer output (via `artifacts`) and produces a score (0–1, or `null` if
not-applicable) plus a `details` object of the given `DetailsType` for report rendering.

## `DetailsType`

Pick the type that matches what the report table should show:

- `table` — most common; rows of data with defined column headings.
- `list` — simple list items, no columns.
- `debugdata` — internal-only data, not rendered in the report UI (useful for diagnostics without
  cluttering the visible report).
- `opportunity` — for audits framed as "you could save N ms/bytes by doing X."

## Categories

Audits are grouped into categories (Performance, Accessibility, SEO, etc.), each with weighted
audits summing to the category score. A new custom category needs: an id, a title, and a list of
`{id, weight}` audit refs. Don't add a new audit to an existing upstream category unless the feature
spec explicitly calls for altering that category's meaning — prefer a new category for this fork's
additions, since altering an existing category's composition changes what every existing user's
`lighthouse:recommended`-based assertions mean.

## LHR (Lighthouse Result)

The full report JSON. Audit results live under `lhr.audits[auditId]`. Category scores live under
`lhr.categories[categoryId]`. This shape is what `packages/server` stores and `packages/viewer`
renders — any change to it downstream of an audit change needs both of those checked, not just the
audit's own test.

## Where this can drift from what's installed

This file describes the mechanism as of when it was written. Lighthouse's actual API can change
between versions — see `upstream-sync.md` for the check that catches that before you design against
a stale assumption.
