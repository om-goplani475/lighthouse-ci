# Phase 6 — Indexability (cross-signal conflict detection)

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-6-indexability` (off `main`),
the fifth phase to use the phase-branch workflow in `AGENTS.md`. Merges into `main` only once every item is
done, deferred, to-do-later, or marked not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

**Status: complete (2026-10-01).** Items 1-3 built together as one feature (`indexability`), QA'd live; see `docs/qa/indexability.md`. **Merged into `main`** (`--ff-only`, 2026-10-01, branch deleted).

## Planning decisions (2026-10-01)

Partly pre-empted by earlier phases, so only what was left was built: `sitemap-indexability` (Phase 4)
already flags a listed URL that is noindex or canonicalised elsewhere, and `robots-directives-conflict`
(Phase 1) already flags meta-versus-header disagreement. Neither is repeated. Build mode (per
`.ai-agents/prompts/build-mode-selection.md`): the roadmap names an outcome, not a mechanism, so a short
design conversation, then lightweight code. Decisions confirmed with the developer:

1. **Two audits.** `indexability-verdict` (informative, never fails: a deliberate noindex is legitimate)
   walks status, robots.txt, meta robots and X-Robots-Tag, canonical and text content and says in plain
   English whether the page can be indexed and why. `indexability-conflicts` (scored) fails only when
   signals contradict each other.
2. **Conflicts that fail** (all four proposed were chosen): noindex that robots.txt hides from a crawler;
   noindex together with a canonical to another URL; robots.txt blocking a page whose canonical points
   elsewhere; a canonical on an error page.
3. **One request to the canonical target** when it is on the page's own origin (status, redirect, noindex,
   robots.txt block, and whether it declares yet another canonical, i.e. a chain). A problem there is also
   reported as a conflict, since catching it is the reason for the request. A cross-origin canonical is
   never requested.

## Features

| # | Feature | Status | Slug / notes |
|---|---------|--------|--------------|
| 1 | Full indexability decision tree per URL | **done** | `indexability-verdict`, feature slug `indexability`. Gatherer `IndexabilitySignals` (canonical from the live head, visible text length, the one target request). |
| 2 | Contradiction detection with a plain-English explanation | **done** | `indexability-conflicts`, same feature. Each conflict row carries a "why it matters and what to do" sentence. |
| 3 | Canonical vs indexability / status-code conflicts | **done** | `indexability-conflicts` (the canonical-target problems and the error-page canonical). |

## How the plan changed while building

- **The error-page branches are unreachable in a default run.** Lighthouse aborts with `ERRORED_DOCUMENT_REQUEST`
  on a 4xx/5xx main document and produces no results, so "Not indexable (HTTP 404)" and the error-page canonical
  conflict (one of the four conflicts the developer chose) only appear with `ignoreStatusCode: true` under
  `ci.collect.settings`. Found in live QA, verified with that setting, documented in the README. The canonical
  *target* returning an error, which is the more common real case, is reached normally.

## Deferred

| Item | Deferred | Why |
|------|----------|-----|
| A canonical declared only in an HTTP `Link` header | not built | the gatherer reads `<link rel=canonical>` from the live head; core's own `canonical` audit covers headers |
| Noindex or canonical injected by JavaScript after load | not built | read from the live DOM at gather time, so most late changes are seen, but a change after the audit's read is not |
| Per-URL decision tree across the whole site | to the multi-page crawler | this phase judges the audited page (plus its canonical target) only |

## To do later

| Item | When | Notes |
|------|------|-------|
| Canonical target that is itself in a different origin | after the crawler | recorded but never requested; one request per audited page is the bound |

## Not possible / permanently out of scope

None identified yet.

## Closing record (2026-10-01)

- **Shipped (2 audits, QA'd live with real Lighthouse and `lhci assert` runs)**: `indexability-verdict`
  (informational) and `indexability-conflicts` (scored), on one gatherer, `IndexabilitySignals`. The fork now
  has 40 audits in the `seo-extended` category. QA record: `docs/qa/indexability.md`.
- **Real findings from QA worth keeping**: (1) Lighthouse stops with `ERRORED_DOCUMENT_REQUEST` on a 4xx/5xx
  main document, so the HTTP-status verdict and the error-page canonical conflict are reachable only with
  `ignoreStatusCode: true` under `ci.collect.settings` (verified live, documented); (2) Chrome's final URL can
  carry a query added after load (`https://www.google.com/?zx=...`), and the audit correctly judges that URL
  against robots.txt; (3) a process error of mine, a stale result file read as a fresh run, was caught and the QA
  runner now deletes its output before each run.
- **Pipeline used**: a short design conversation (three blocking questions), then lightweight code, per
  `.ai-agents/prompts/build-mode-selection.md`. No formal design documents.
- **Security**: no finding. The one new request goes to a page-chosen URL (the canonical) and is made only for a
  same-origin target, through the SSRF-protected fetch; a spy server on another port received zero requests.
  See `.ai-agents/state/security-findings.md`.
- **Tests**: 1,013 seo-audits tests pass, also under Node 18.20.8 (what CI pins); repo-wide typecheck and lint are
  clean. **Not verified**: `packages/viewer` rendering of the new audits, `npm run start:seed-database`, and a real
  GitHub Actions run with the environment variables (planned after this phase).
- **Branch**: `phase-6-indexability` was 5 commits ahead of `main` before this closing record. It was **merged into
  `main`** with `--ff-only` (tip `9b5b973`, 2026-10-01) and deleted, per `AGENTS.md`.
