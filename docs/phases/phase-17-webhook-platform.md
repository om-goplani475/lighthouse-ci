# Phase 17: CI/DevOps and webhook platform

Status: **slices 1-3 built** on branch `phase-17-ci-devops`. Build mode: full pipeline, in slices; each slice is tested, then committed on approval.

## Goal

Other repositories do not install `@lhci/cli` or run Chrome. They send a webhook (PR opened, deployment ready) with a preview URL and commit data. A central service audits the URL, applies that project's rules, posts a PR comment with the Phase 16 score and deltas, and alerts Slack/Teams when something critical breaks. A dashboard lets people run an audit on demand, edit per-project rules, and read webhook and run history.

## Decisions and tradeoffs

| # | Decision | Why / tradeoff |
|---|---|---|
| D1 | New logic lives in `packages/seo-audits/src/service/` (pure: config, signature check, queue rules, dispatch payloads) and a new `packages/seo-service` is **not** created; the server gets an additive mount (`/api/v1/webhooks`, `/api/v1/seo`) | The fork rule says not to edit `packages/server` source except through an extension point. A single mount line + new files keeps `git pull upstream main` mergeable. The mount line is the extension point and needs the owner's approval before slice 3 |
| D2 | Webhook auth is a per-project secret: HMAC-SHA256 over the raw body, constant-time compare, timestamp window, replay guard | GitHub/GitLab already sign this way; no shared basic-auth password reaches other repos |
| D3 | The audited URL is untrusted input. Every URL goes through the existing `safe-fetch` rules (public addresses only, `LHCI_SEO_ALLOW_PRIVATE_NETWORK` off by default) **and** an optional per-project host allow-list | Without it the service is an SSRF proxy and an open crawler. The allow-list is mandatory for webhooks, optional for the dashboard's on-demand run (admin token) |
| D4 | One audit at a time per worker, a bounded queue (default 20), a per-project rate limit, a hard run timeout | Chrome is heavy; a flood of webhooks must not exhaust the host |
| D5 | Per-project config = preset + `categories` overrides + `audits` overrides, each `error`, `warn` or `off`; resolved to an ordinary lhci `assertions` object | Reuses `lhci assert` semantics; the same config works in a normal `lighthouserc.js` |
| D6 | PR comment is one sticky comment per PR (found by a hidden marker, edited in place). Outbound calls go to GitHub/GitLab/Slack/Teams only, with SSRF guard on webhook targets and secrets never logged | Many comments per push is noise; outbound targets are user-supplied, so they are guarded too |
| D7 | Baseline for deltas = the latest finished run of the same project and URL path on the base branch, from the database | No artifacts to fetch; works for every repo |
| D8 | Alert on "critical" = new error-tier issue from a fixed list (`robots-directives-conflict`, `indexability-verdict`, `robots-txt-crawler-access`, `canonical-conflicts`, ...) that the baseline did not have | Alerts only on regressions, so a site that was already broken does not page anyone |

## Slices

1. **Project config and presets** *(done)* (`src/service/project-config.js`): presets `seo:recommended`, `seo:strict`, `ecommerce`, `blog`, `internal-portal`, `minimal`; validation; resolution to assertions. *(this slice)*
2. **Webhook verification** *(done)* (`src/service/webhook-signature.js`, `webhook-payload.js`, `host-allow-list.js`): HMAC check, replay window, GitHub/GitLab payload normalisation to `{repo, prNumber, sha, url}`.
3. **Storage and routes** *(done)* (`packages/server/src/seo/`): tables `seo_projects`, `seo_runs`, `seo_webhook_logs`; routes; queue; three lines in `server.js`.
4. **Runner**: executes `collect` for the URL with the resolved config, runs Phase 16 summary and compare against the baseline.
5. **Dispatcher**: PR comment (GitHub first, GitLab second), Slack/Teams alerts.
6. **Dashboard** (server UI, new route directory): on-demand run, rules editor, webhook log, run history.
7. **Docs, QA against a real run, security review.**

## Security notes (carried into each slice)

- Raw-body signature check before any parsing; reject on mismatch with a constant-time compare.
- Body size limit on webhook routes far below the 10 MB used for LHR uploads.
- No secret ever in a log line, a stored webhook log (headers are redacted) or an error message.
- Run-time limits: queue length, per-project rate, per-run timeout, crawl limits from the existing env vars.
- A project config cannot raise crawl limits above the service's own ceilings.

## Slice 3 as built

- **Tables** are created with `sync()` on the server's own connection, not with migrations, so no upstream migration file is added. Rows older than 30 days (logs) and 180 days (runs) are pruned at most once an hour, on an accepted delivery. The webhook log stores outcome and reason only, never headers or bodies.
- **Mount** is three lines in `server.js` (plus two `require`s): the webhook router goes before the body parser and basic auth (it keeps the raw body and has a 1 MB cap); the management router goes after them. `LHCI_SEO_SERVICE=off` disables the whole service. `packages/server/package.json` gained the `@lhci/seo-audits` workspace dependency (`yarn install --frozen-lockfile` still passes).
- **Loading ESM from CommonJS:** the server is CommonJS and `@lhci/seo-audits` is ESM, so `seo/load-deps.js` uses a dynamic `import()`. Checked in plain Node 24 and 18.20.8.
- **Routes** (management ones need the LHCI project's `x-lhci-admin-token`): `PUT|GET|DELETE /api/v1/seo/projects/:id/config`, `POST .../rotate-secret`, `GET .../runs`, `GET .../runs/:runId`, `GET .../webhook-logs`, `POST .../runs` (on-demand); public `POST /api/v1/webhooks/:id`, which needs a valid signature. The secret is returned once, on create or rotate.
- **Limits:** queue of 20 waiting jobs with 1 worker; 10 accepted deliveries per project per 10 minutes; a 10-minute run timeout; a restart closes unfinished runs as failed. A repeated delivery id is answered `200 duplicate` (GitHub's "Redeliver" button reuses the id, so a manual redelivery inside 10 minutes is ignored).
- **Known gap for slice 4 (security):** the allow-list and `safe-fetch` guard the service's own requests, but **Chrome** will load the target itself. The runner must resolve the host and refuse private, loopback and link-local addresses *before* launching Chrome, and again for redirects, or an allowed hostname that points at an internal address would be audited. Until slice 4 the runner is not installed, and a queued run fails with "the audit runner is not installed on this server".
