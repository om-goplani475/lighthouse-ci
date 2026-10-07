# Phase 17: CI/DevOps and webhook platform

Status: **Done (slices 1-7), merged into `main`** (2026-10-06; the branch `phase-17-ci-devops` is deleted). The test-webhook tool was added afterwards and merged too. Build mode: full pipeline, in slices; each slice is tested, then committed on approval.

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
4. **Runner** *(done)*: executes `collect` for the URL with the resolved config, runs Phase 16 summary and compare against the baseline.
5. **Dispatcher** *(done)*: PR comment (GitHub first, GitLab second), Slack/Teams alerts.
6. **Dashboard** *(done)* (server UI, new route directory): on-demand run, rules editor, webhook log, run history.
7. **Docs, QA against a real run, security review** *(done)*.

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
- **Known gap for slice 4 (security):** closed in slice 4, below.

## Slice 4 as built: the guard proxy and the runner

- **`src/service/guard-proxy.js`**: a forward proxy on 127.0.0.1 that Chrome is forced through (`--proxy-server`, `--proxy-bypass-list=<-loopback>`). Chrome leaves name resolution to the proxy, which resolves every host itself, refuses any private or reserved address (never honouring `LHCI_SEO_ALLOW_PRIVATE_NETWORK`), and connects to the address it checked, so redirects, subresources and DNS rebinding are all covered. HTTPS passes as an opaque CONNECT tunnel. Only ports 80, 443, 8080 and 8443 are allowed. It lives for one run. `blocked` lists address refusals (reported on the run); `denied` lists port refusals (mostly Chrome's own background traffic, such as Google's push service on 5228).
- **Checked live with real Chrome:** a page on `127.0.0.1` (on an allowed port) was refused and its server saw 0 requests; `https://web.dev/` audited normally through the proxy (57 audits, no runtime error).
- **`src/service/run-audit.js`**: re-checks the URL against the allow-list, resolves its host to public addresses only, starts the proxy, runs `lhci collect` as a child process in its own process group (killed on timeout or abort), scores the report with the project's severities (`off` audits are not scored), and compares it with the baseline. The child's environment is built from an allow-list (no database or cloud credentials, never the private-network opt-in); each run has its own temp folder and its own crawl cache, so a later push never sees an earlier push's pages. Operators can add Chrome flags with `LHCI_SEO_SERVICE_CHROME_FLAGS` (for example `--no-sandbox` in a container); any flag that could undo the proxy is dropped and the guard flags are placed last.
- **`src/service/run-result.js`**: stores a run as plain data (every audit result, about 60 small rows) and revives it for comparison; damaged data counts as "no baseline".
- **Baseline:** the latest finished run of the same path on the base branch (a pull request is compared with `baseBranch`; a base-branch run with its own previous run). The host is ignored because preview hosts change per pull request. For this to work, the base branch must also send events (a `deployment_status` or `lhci` delivery with `branch: main`).
- **Real end-to-end run** (real server, signed webhook, queue, runner, Chrome, `web.dev`): done in about 2 minutes while the machine was busy; a second run on a `feat` branch with `baseBranch: main` came back with a comparison (delta 0); a private URL was refused with 422.
- **Server wiring:** `load-deps.js` builds the real runner; `@lhci/cli` was added to the server's dependencies (no cycle; `yarn install --frozen-lockfile` passes).
- **Not covered:** a hostile page cannot be stopped from using Chrome's CPU for the whole run timeout (10 minutes); the queue and rate limits bound how many such runs happen. A site that serves different content to the proxy's address cannot be told apart from one that does not.

## Slice 5 as built: the dispatcher

- **`outbound.js`** is the only way the service sends a request: https only, no credentials in the URL, public addresses only (same lookup guard as the audits; the connection goes to the address that was checked), **no redirects followed** (a redirect could carry a token to another host), a 10 s timeout and a 1 MB response cap. Checked against real `api.github.com` over TLS; `localhost` and `127.0.0.1` are refused.
- **`notifier.js`** decides where a project may send things: Slack only to `hooks.slack.com`; Teams only to `*.webhook.office.com`, `outlook.office.com`, `*.logic.azure.com` or `*.environment.api.powerplatform.com`; GitHub and GitLab to their cloud API, or a self-hosted `apiBase` that is https, a public host name, with no query. Tokens must be printable ASCII with no spaces (no header injection). Every error text passes through `redact`, so a token or webhook URL never reaches a result, a log row or the API.
- **Sticky pull request comment** (`pr-comment.js`): the first line is a hidden marker `<!-- lhci-seo-audit:<projectId> -->`. The service lists the pull request's comments (up to 5 pages of 100), edits the one with the marker, or posts a new one; if the marked comment cannot be edited (403/404, for example someone else pasted the marker) it posts its own. GitHub uses `PATCH`, GitLab `PUT` with `PRIVATE-TOKEN`. It shows the score and grade, the change since the baseline, per-category movement, new / fixed / still-failing issues (10 per list), a link to the report when `LHCI_SEO_PUBLIC_URL` is set (the dashboard route comes in slice 6), and stays under 60,000 characters (GitHub's limit is 65,536).
- **Text from the audited page is hostile.** It goes through the table-cell escaper; `@` is broken with a zero-width space so a page cannot make a comment notify a user or team; Slack control sequences (`<!channel>`, links, `&`) are escaped; a report link is percent-encoded including parentheses (`encodeURIComponent` leaves them alone, which would have broken the markdown link: caught by a test).
- **Alerts** go to Slack and/or Teams for a **new critical regression**: an error-tier audit from a fixed list (`robots-directives-conflict`, `indexability-conflicts`, `robots-txt-crawler-access`, `canonical-conflicts`, `canonical-https`, `redirect-loop`, `sitemap-valid`, `mixed-content`, `ssl-certificate-expiry`; a project can pick its own list) that fails now and did not in the baseline, **or** a page whose Lighthouse `is-crawlable` score fell from 1 to 0 (an accidental `noindex` or robots block; `indexability-verdict` is informational, so the runner records Lighthouse's own `is-crawlable` and `http-status-code` as signals). Needs a baseline: on a first audit nothing is "new", so a site that was already broken does not page anyone. By default only runs that are not pull requests alert (`alerts.includePullRequests` turns it on). Teams gets a legacy MessageCard for `webhook.office.com` and an Adaptive Card for Workflows hosts.
- **Server:** a new table `seo_notifications` (secrets, stored like the webhook secret, never returned) and routes `GET|PUT /api/v1/seo/projects/:id/notifications` (admin token; a patch merges, `null` removes, the merged result is validated too). Dispatch happens after a run is saved as done; a failure is logged (`comment-posted`, `comment-failed`, `alert-sent`, `alert-failed`) and **never changes the run's status**. One retry on a network error, 429 or 5xx; at most 60 s for all sending.
- **Not verified:** posting to a real GitHub or GitLab pull request and sending to a real Slack or Teams webhook. That needs your tokens and webhook URLs; the requests are tested against fakes of the documented APIs. A GitHub App installation token works as the token; GitHub App registration itself is not built.

## Slice 6 as built: the dashboard

New screens in `packages/server/src/ui/` (new files plus two small edits: two routes in `app.jsx`, one sidebar icon in `page-sidebar.jsx`; no upstream component was changed):

- **`/app/projects/:slug/seo`** (a "travel_explore" icon beside each project in the sidebar). Needs the project admin token, kept in `localStorage` per project exactly as the existing project settings page does; it asks for one when missing or refused. A project that has not set the service up gets a setup form (provider, allowed hosts, default URL); the webhook address and **secret are shown once**, then never again.
  - **Runs:** run an audit now (the host must be on the allow-list, otherwise the server's reason is shown), and the last 25 runs with status, score, grade and change since the baseline. It refreshes every 3 s while a run is queued or running.
  - **Webhook log:** every delivery and what was done with it (queued, ignored, duplicate, rejected, rate limited, comment posted, alert sent...).
  - **Rules and destinations:** preset, a severity (`error`, `warn`, `off`) per category and per audit with the effective severity shown, hosts, default URL, rotate secret; tokens and Slack/Teams webhook URLs for comments and alerts (never shown back: an empty field keeps the stored value, a checkbox removes it); turn the service off.
- **`/app/seo/:projectId/runs/:runId`**: one run (the page the pull request comment links to via `LHCI_SEO_PUBLIC_URL`): status, page, commit, score with the change, categories and the new, fixed and remaining issues.
- **API additions:** `GET /api/v1/seo/projects/:id/meta` (presets, categories, scored audits, effective severities) and, in the run list, each finished run's `score`, `grade` and `delta` (read from the stored result, so the list is limited to 25 by the page).
- **Safety:** all text, including anything that came from the audited page, is rendered by Preact (escaped); no `dangerouslySetInnerHTML`. A page URL becomes a link only when it is http(s). Requests never throw: a missing or refused token, a validation problem (every problem listed), a busy server and a network failure are each shown as what they are.
- **Checked in real Chrome against the real server** (puppeteer, a fresh database): no token asks for the token; an off-list URL is refused with the server's message; **a run started from the page audited `web.dev` in 1m48s and showed 91.4 (A)**; the run page, webhook log (the rejected delivery) and settings rendered; saving a preset through the page changed it on the server; a stored Slack URL was accepted and its secret part is not on the page; no console or page errors.
- **Not done / known:** the run list reads each finished run's stored report to get its score, which is fine at 25 rows but would want a stored score column if the list grows; the UI has no automated screenshot test (the existing screenshot suites fail on this machine for font reasons), so the screens were checked by hand in Chrome and the logic behind them is unit tested.

## Slice 7: docs, QA and the security review

- The README has a "webhook service" section and the new variables; `docs/qa/webhook-platform.md` lists what was checked and the five things that need real destinations; `docs/open-items.md` has item H for them.
- **Security pass over the whole phase** (`.ai-agents/state/security-findings.md`): one low finding, fixed: failed signatures wrote an unbounded number of log rows to anyone who knew the project's webhook URL; failed-signature logging is now capped at 20 per project per minute, with a test. Odd project ids and hostile bodies were probed (a test): client errors only, no 500. Accepted and documented: secrets in clear in the database, the admin token in `localStorage` (as upstream does), no per-address rate limit (use a reverse proxy), a page can keep Chrome busy for the 10-minute limit, in-memory replay memory.
- **Not built, deliberately:** per-template grouping of pages, scheduled crawl diffs with alerting, SARIF output (it needs code scanning and file locations the audits do not have), GitHub App registration, a stored score column for the run list, secrets encrypted at rest.
