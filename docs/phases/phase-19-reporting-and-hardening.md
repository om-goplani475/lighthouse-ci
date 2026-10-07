# Phase 19: reporting, SARIF, SERP preview, template detection, encrypted secrets

Branch `phase-19-reporting-and-hardening`. Build mode: full pipeline per slice, one approval per slice. Decisions taken with the developer (2026-10-07): the seven deferred product features are split in two branches. **This one (19)** holds what needs no new infrastructure. **Phase 20** holds the scheduler/monitoring and the GitHub App. **AI-generated fixes are skipped for now** (no LLM provider chosen). Monitoring, when built, runs inside the LHCI server process.

## Slices

| Slice | What | Where | Security note |
|---|---|---|---|
| 1. Encrypted secrets | AES-256-GCM for the webhook secret and the notification config (GitHub/GitLab token, Slack/Teams URL). Key in `LHCI_SEO_SECRET_KEY` (32 bytes, hex or base64). Stored as `enc:v1:<iv>:<tag>:<data>`; old plain rows still read and are re-encrypted on their next write. `LHCI_SEO_SECRET_KEY_PREVIOUS` lets the key be rotated. No key set: plain storage as today, with a startup warning. A wrong key fails closed (the row is unreadable, the delivery is refused), never falls back to plain. | `seo/secret-box.js`, `seo-store.js` | Key never logged or returned. The HMAC secret must stay readable, so encryption (not hashing). |
| 2. SARIF | `lhci-seo summary --format sarif` and `GET /api/v1/seo/projects/:id/runs/:runId/sarif`: failing and warning audits as SARIF 2.1.0 results (rule id = audit id, level error/warning, location = audited URL), ready for GitHub code scanning `upload-sarif`. | `summary/sarif.js` (pure), CLI flag, one route | Admin token on the route; output has no secrets. |
| 3. Reporting and history | Per project and URL: a series of overall and category scores and issue counts per run; compare any two runs (reuses `summary/compare.js`); CSV and JSON export; dashboard trend chart. | `service/run-history.js` (pure), 3 routes, UI | Reads existing `seo_runs`; bounded (200 runs, 180-day retention already in place). |
| 4. SERP preview | A rendered Google-style snippet (desktop and mobile) from the audited page's title, description and URL, truncated by the same pixel widths as `pixel-width-truncation`, stored per run so a change in the snippet between runs is visible. | `lib/serp-preview.js` (pure), run result field, UI component | Text is escaped on render; no request to Google. |
| 5. Template detection | From the crawl snapshot: group crawled URLs by path pattern (`/blog/:slug`, `/product/:id`), then report per template how many pages are affected by each page-level problem, so a template bug reads as "one fix, 80 pages". Informational audit `template-groups-report` plus a per-template table in the run summary. | `lib/templates.js` (pure), 1 audit | Reads the crawl only; no new request. |

Order: 1, 2, 3, 4, 5 (security first, then the cheapest, then the ones that touch the UI).

## Status

- **1. Encrypted secrets: built** (60 server tests, three new files; see `.ai-agents/state/security-findings.md`).
- **2. SARIF: built.** `summary/sarif.js` (pure), `--format sarif` and `--sarif-file` on the summary command, and `GET /api/v1/seo/projects/:id/runs/:runId/sarif[?file=]`. A real Chrome run on a page with known defects gave 8 results and 8 rules and **validates against the official OASIS SARIF 2.1.0 schema** (a deliberately wrong log does not). One design decision worth knowing: a web page is not a repository file, so by default the location is the page URL; GitHub only shows file-based alerts, hence the optional `file` mapping. **Not verified:** a real `upload-sarif` to GitHub code scanning (open-items J).

- **3. Reporting and history: built.** `service/run-history.js` (pure: series, CSV, comparison), three routes (`history`, `history.csv`, `compare`), and a **History** tab in the dashboard (line chart for one page at a time, CSV download, compare any two runs, runs table). Checked live with a real server and Chrome (`docs/qa/webhook-platform.md`). Bounded: the newest 200 finished runs; the 180-day run retention already in place limits the depth. Not built: PDF export and evidence/DOM-location capture (they need design).

- **4. SERP preview: built.** `lib/serp-preview.js` (pure), the gatherer now also measures the width of every prefix of the first 400 characters (`prefixWidths`, so the cut is placed by the browser's real measurements, not an average), `pixel-width-truncation` carries `details.serpPreview`, the service stores `result.serp` and `result.serpChange` (title, description, address changed since the baseline), and the run page has a "Search result preview" panel. **No new audit** (still 125) and no new request. Checked live with real Chrome on a page with an over-long title and description (title cut at the 600 px desktop and 580 px mobile budgets) and rendered in the dashboard. Costs about 400 numbers per text in every report (the audit result grew by well under 10 KB). **Not built:** a live "type a title and see the snippet" editor and rich-result variants (stars, prices).

## Phase 20 (next branch, not started)

- **Monitoring**: per-project schedule (daily, weekly) in the server process, reusing the Phase 17 queue and rate limit, comparing each run with the previous one and alerting on regressions through the existing notifier.
- **GitHub App**: JWT and installation tokens in place of a personal access token, with App webhook secret handling. Registering the App on GitHub is the developer's own step.

## Not planned

AI-generated fixes (needs a provider and key policy).
