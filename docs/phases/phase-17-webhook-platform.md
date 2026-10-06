# Phase 17: CI/DevOps and webhook platform

Status: **design + slice 1 in progress** on branch `phase-17-ci-devops`. Build mode: full pipeline, in slices; each slice is tested, then committed on approval.

## Goal

Other repositories do not install `@lhci/cli` or run Chrome. They send a webhook (PR opened, deployment ready) with a preview URL and commit data. A central service audits the URL, applies that project's rules, posts a PR comment with the Phase 16 score and deltas, and alerts Slack/Teams when something critical breaks. A dashboard lets people run an audit on demand, edit per-project rules, and read webhook and run history.

## Decisions and tradeoffs

| # | Decision | Why / tradeoff |
|---|---|---|
| D1 | New logic lives in `packages/seo-audits/src/service/` (pure: config, signature check, queue rules, dispatch payloads) and a new `packages/seo-service` is **not** created; the server gets one additive mount (`/api/v1/webhooks`, `/api/v1/seo`) plus one migration file | The fork rule says not to edit `packages/server` source except through an extension point. A single mount line + new files keeps `git pull upstream main` mergeable. The mount line is the extension point and needs the owner's approval before slice 3 |
| D2 | Webhook auth is a per-project secret: HMAC-SHA256 over the raw body, constant-time compare, timestamp window, replay guard | GitHub/GitLab already sign this way; no shared basic-auth password reaches other repos |
| D3 | The audited URL is untrusted input. Every URL goes through the existing `safe-fetch` rules (public addresses only, `LHCI_SEO_ALLOW_PRIVATE_NETWORK` off by default) **and** an optional per-project host allow-list | Without it the service is an SSRF proxy and an open crawler. The allow-list is mandatory for webhooks, optional for the dashboard's on-demand run (admin token) |
| D4 | One audit at a time per worker, a bounded queue (default 20), a per-project rate limit, a hard run timeout | Chrome is heavy; a flood of webhooks must not exhaust the host |
| D5 | Per-project config = preset + `categories` overrides + `audits` overrides, each `error`, `warn` or `off`; resolved to an ordinary lhci `assertions` object | Reuses `lhci assert` semantics; the same config works in a normal `lighthouserc.js` |
| D6 | PR comment is one sticky comment per PR (found by a hidden marker, edited in place). Outbound calls go to GitHub/GitLab/Slack/Teams only, with SSRF guard on webhook targets and secrets never logged | Many comments per push is noise; outbound targets are user-supplied, so they are guarded too |
| D7 | Baseline for deltas = the latest finished run of the same project and URL path on the base branch, from the database | No artifacts to fetch; works for every repo |
| D8 | Alert on "critical" = new error-tier issue from a fixed list (`robots-directives-conflict`, `indexability-verdict`, `robots-txt-crawler-access`, `canonical-conflicts`, ...) that the baseline did not have | Alerts only on regressions, so a site that was already broken does not page anyone |

## Slices

1. **Project config and presets** (`src/service/project-config.js`): presets `seo:recommended`, `seo:strict`, `ecommerce`, `blog`, `internal-portal`, `minimal`; validation; resolution to assertions. *(this slice)*
2. **Webhook verification** (`src/service/webhook-signature.js`): HMAC check, replay window, GitHub/GitLab payload normalisation to `{repo, prNumber, sha, url}`.
3. **Storage and routes** (server): tables `seo_projects`, `seo_runs`, `seo_webhook_logs`; routes; queue; the one mount line.
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
