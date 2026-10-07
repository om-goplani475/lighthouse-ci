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

## Phase 20 (next branch, not started)

- **Monitoring**: per-project schedule (daily, weekly) in the server process, reusing the Phase 17 queue and rate limit, comparing each run with the previous one and alerting on regressions through the existing notifier.
- **GitHub App**: JWT and installation tokens in place of a personal access token, with App webhook secret handling. Registering the App on GitHub is the developer's own step.

## Not planned

AI-generated fixes (needs a provider and key policy).
