# QA: the webhook platform (Phase 17)

Design: `docs/phases/phase-17-webhook-platform.md`. What was checked on 2026-10-06 (Node 24 and 18.20.8), what you can repeat, and what is not verified.

## Done, and how to repeat it

| Check | Result | Repeat with |
|---|---|---|
| Unit and integration tests | 2,300 tests across `seo-audits`, the server's `test/seo` and the dashboard logic pass on Node 24 and 18.20.8; typecheck and lint clean | `npx jest packages/seo-audits packages/server/test/seo packages/server/test/ui/seo` |
| Signature, replay, payload, allow-list | GitHub, GitLab and the generic form; wrong secret, tampered body, stale timestamp, replay, bad JSON, 1 MB cap, off-list and private hosts, look-alike hosts, repo name `../x` | `test/service/webhook-*.test.js`, `host-allow-list.test.js`, `test/seo/seo-service.test.js` |
| The Chrome guard, live | A page on `127.0.0.1` (allowed port) was refused and its server saw 0 requests; `https://web.dev/` audited normally through the proxy | `guard-proxy.test.js`; the live script is described in the phase doc |
| Real end to end | Real server, signed webhook, queue, runner, Chrome, `web.dev`: done in about 2 minutes (machine busy); a second run on a `feat` branch with `baseBranch: main` carried a comparison; a private URL was refused with 422 | send a signed `lhci` delivery as in the README |
| Dashboard in real Chrome | Token prompt; off-list URL refused with the server's message; a run started from the page scored 91.4 (A) in 1m48s; run page, webhook log and settings rendered; a preset saved through the page; a stored Slack URL not shown back; no console errors | open `/app/projects/<slug>/seo` |
| Outbound sender, real TLS | `api.github.com` answered over TLS; `localhost` and `127.0.0.1` refused | `outbound.test.js` |
| Server upstream behaviour | the existing sqlite and basic-auth server suites still pass with the service mounted; `yarn install --frozen-lockfile` passes | `npx jest packages/server/test/sqlite-server` |

## Trying the baseline comparison without GitHub

`packages/seo-audits/src/service/send-test-webhook.js` (see the README) sends signed deliveries in the CI-job form. Send one with `--branch main`, wait for it to finish, then one with `--branch feat --base-branch main --pr 5`: the second run's score carries a change against the first in the dashboard's Runs tab and on the run page. These deliveries use the CI-job form, so they never post a pull request comment (that needs a GitHub or GitLab delivery); Slack and Teams alerts do work with them.

## Not verified (needs you)

1. **A real pull request comment** on GitHub and on GitLab with a real token: the requests are tested against fakes of the documented APIs. Create a token that can comment, store it under *Rules and destinations*, open a pull request that sends a webhook, and check that **one** comment appears and is edited (not duplicated) by a second push.
2. **A real Slack and Teams alert.** Store a webhook URL, then make a base-branch run introduce a critical problem (for example add `<meta name="robots" content="noindex">` to a page that was indexable) and check the message arrives, once.
3. **A real GitHub webhook delivery** (the *Recent Deliveries* page of the webhook shows the server's answer: 202, or 200 for an ignored event).
4. **Running in a container** with `LHCI_SEO_SERVICE_CHROME_FLAGS=--no-sandbox` and memory limits; the code path for those flags is unit tested only.
5. **Several projects at once** (the queue runs one audit at a time; check the queue-full answer under real load).

## Known limits

- The queue and the replay memory are in the server's memory: a restart closes unfinished runs as failed, and a GitHub delivery id replayed after a restart inside the 10-minute window is accepted once more.
- GitHub's **Redeliver** button reuses the delivery id, so a redelivery within 10 minutes is answered `duplicate` and ignored.
- A hostile page can keep Chrome busy for the 10-minute limit.
- Secrets are stored in clear unless `LHCI_SEO_SECRET_KEY` is set (Phase 19).
- The run list reads each finished run's stored report to show its score (25 rows).

## Template detection (Phase 19, slice 5), checked live 2026-10-07

Real `lhci collect` (Chrome and the real crawler, private-network opt-in on) on a local site of 18 pages: home, about, 10 blog posts (none with a meta description, three sharing a title) and 6 shop pages (all under 200 words, two without an h1). `template-groups-report` found two templates and 2 single pages: `/blog/:slug` (10 pages: no meta description 10 of 10, one fix in the template; shared title 3 of 10, not shared) and `/shop/:slug` (6 pages: thin text 6 of 6, one fix; no h1 2 of 6, not). Rendered from a stored run on the run page by Chrome as a **Templates** table. Unit tests cover the grouping (numeric ids, a fixed middle part, single pages, query strings, odd addresses, two pages are not a template), the counting and the 80% rule, damaged stored data and hostile text. **Not checked:** a large real site (the default crawl reaches 30 pages, so only large templates are seen).

## Search result preview (Phase 19, slice 4), checked live 2026-10-07

Real `lhci collect` (Chrome) on a page with a 140-character title and a 330-character description: the audit's details carried the preview; the title was cut at "...Handmade Leather Boots Online…" on desktop (600 px) and one word earlier on mobile (580 px), the description at the ruleset's budget. The real preview was stored with a run and rendered on the run page by Chrome: two cards, "Changed since the earlier run: title", and the note that it is an approximation. Unit tests cover the cut (emoji never split, trailing punctuation dropped, a long word backed up to the previous word, no title or description, hostile text kept as plain strings, a huge text bounded) and the service test covers the stored preview and the change flags. **Not checked:** how close the cut is to what Google really shows (Google does not publish it).

## History and comparison (Phase 19, slice 3), checked live 2026-10-07

Real server (`lhci server`, SQLite), real dashboard built with `build:esbuild`, 16 finished runs of two pages seeded from a real Lighthouse report with one more audit fixed per day, Chrome driving the page:

- **History tab**: the chart draws one dot per run for the chosen page (8 for 8 runs); the page list is ordered by number of runs and the first is chosen at start (one page per line: with two pages in one line the chart zigzagged, found here and fixed).
- **Compare two runs**: 76.2 to 97.6 (+21.4), 5 issues listed as fixed, 2 still failing, matching the numbers in the table below it.
- **CSV** (`GET .../history.csv`): header plus a column per category, one row per run; cells that start with `=`, `+`, `-` or `@` are prefixed so a spreadsheet does not run them (unit tested).
- **Not checked**: the browser's "Download CSV" button saving a file (the same request is tested over HTTP); a project with more than 200 finished runs (only the newest 200 are read).

