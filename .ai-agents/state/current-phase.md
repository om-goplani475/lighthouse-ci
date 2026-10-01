# Current phase

- phase: 5 (crawlability & status codes)
- branch: phase-5-crawlability
- roadmap: docs/phases/phase-5-crawlability.md
- status: in-progress

<!-- Phase 1 (page-metadata) closed 2026-09-30: every item (0-6) done or closed-no-build-needed,
ff-merged into main (a1e8313), branch phase-1-page-metadata deleted. See
docs/phases/phase-1-page-metadata.md for the full breakdown, including its "To do later" table of
basic-vs-advanced choices made along the way. -->

<!-- Phase 2 (structured data) has remaining Deferred/To-do-later items (see
docs/phases/phase-2-structured-data.md) but was never given its own phase branch (built before the
phase-branch convention existed, decided 2026-09-29 not to retroactively branch it) — any further
Phase 2 work continues on the plain feat/{slug} -> main flow, same as before. All six scoped items
done as of 2026-09-30 (item 6, structured-data-deprecated-properties, merged c2fb340). -->

<!-- Phase 3 (social/sharing metadata) closed 2026-09-30: all five items done. Items 1-4 built
lightweight-mode; item 5 (social preview renderer) got a short design conversation, which surfaced
a real architectural finding — a true visual render isn't achievable inside a standard Lighthouse
report without editing packages/viewer (against this fork's own boundary rule) — and was scoped
down to a text-based preview-content report instead, confirmed via blocking question. Also found
and fixed a real pre-existing bug in safe-fetch.js's safeLookup (broke every real outbound fetch to
a non-literal-IP hostname) during item 3's live QA. ff-merged into main, branch
phase-3-social-metadata deleted. See docs/phases/phase-3-social-metadata.md for the full
breakdown. -->

<!-- Phase 4 (robots.txt & sitemap) closed 2026-10-01: all ten tracker rows (the roadmap's twelve
bullets) done, ten audits shipped (31 in the fork), no security finding open. ff-merged into main,
branch phase-4-robots-sitemap deleted. Notable: the first gatherer with outbound requests
(SitemapDocuments, with a shared page sample), two high-severity security findings found by running
attacks and fixed (an IPv6 SSRF bypass in safe-fetch.js dating from Phase 1, and a quadratic-time XML
parser), a private-network opt-in for CI (LHCI_SEO_ALLOW_PRIVATE_NETWORK), and a 40 s gatherer time
budget. See docs/phases/phase-4-robots-sitemap.md, including its "How the plan changed" section and
"Closing record". One open item outside this phase: the 12 failing suites in a full `npm run test` were
never compared with the base branch (.ai-agents/state/ci-backlog.md). -->

<!-- When the next phase starts: if it gets a phase branch, update this file the same way
phase-1-page-metadata's/phase-3-social-metadata's entries looked (phase/branch/roadmap/status:
in-progress) and Agent 04 branches feat/{slug} off it per AGENTS.md's "Phase branches" section. -->
