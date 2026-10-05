# Current phase

- phase: none in progress
- branch: main
- roadmap: docs/master-roadmap.md (next: Phase 9, URL Quality) and docs/open-items.md (the verification checks still to do)
- status: idle

<!-- Phase 8 (internal linking & site graph) closed 2026-10-05: all seven items done (crawler to depth 3, link-graph, link-check, anchor-text, pagination and external-link audits), ff-merged into main, branch phase-8-internal-linking deleted. See docs/phases/phase-8-internal-linking.md. -->

- phase: 8 (internal linking & site graph)
- branch: phase-8-internal-linking
- roadmap: docs/phases/phase-8-internal-linking.md
- status: in-progress

<!-- Phase 7 (duplicate & consistency detection) closed 2026-10-02: the crawler core and four audits done, ff-merged into main (28939f1), branch phase-7-duplicates deleted. See docs/phases/phase-7-duplicates.md. -->

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

<!-- Phase 5 (crawlability & status codes) closed 2026-10-01: all five tracker rows done or deferred, seven
audits shipped (38 in the fork), one low security finding found and fixed, none open. ff-merged into main,
branch phase-5-crawlability deleted. Link-level checks (4xx/5xx internal URLs, redirecting links) were
deferred to the multi-page crawler by the developer's choice. Notable: an LHCI quirk where an audit id with a
hyphen followed by a digit breaks `lhci assert` (rule in lighthouse-conventions.md), and two gatherers that
follow redirects only to the page's own host variants. See docs/phases/phase-5-crawlability.md, including its
"How the plan changed" section and "Closing record". -->

<!-- Phase 6 (indexability) closed 2026-10-01: all three tracker rows done as one feature, two audits shipped
(40 in the fork), no security finding. ff-merged into main, branch phase-6-indexability deleted. Notable:
Lighthouse stops on a 4xx/5xx main document, so the HTTP-status verdict and the error-page canonical conflict need
`ignoreStatusCode: true` under ci.collect.settings; and the audit judges the final URL Chrome reports (which can
carry a query added after load). See docs/phases/phase-6-indexability.md, including its "How the plan changed"
section and "Closing record". -->

<!-- When the next phase starts: if it gets a phase branch, update this file the same way
phase-1-page-metadata's/phase-3-social-metadata's entries looked (phase/branch/roadmap/status:
in-progress) and Agent 04 branches feat/{slug} off it per AGENTS.md's "Phase branches" section. -->
