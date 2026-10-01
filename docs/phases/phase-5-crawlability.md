# Phase 5 — Crawlability & Status Codes

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-5-crawlability` (off
`main`), the fourth phase to use the phase-branch workflow in `AGENTS.md`. Merges into `main` only once
every item is done, deferred, to-do-later, or marked not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

**Status: in progress (2026-10-01).** All five items done (1-3 `transport-security`, 5 `soft-not-found`, 4 `url-variants`), merged into this branch and QA'd live. Ready to close out (merging into `main` is the developer's call).

## Planning decisions (2026-10-01)

Checked against Lighthouse 12.6.1 first (see "What Lighthouse core already does"), then three decisions
confirmed with the developer:

1. **Mixed content and HSTS: build fork versions anyway**, although core's `is-on-https` and `has-hsts`
   cover much of the same ground. The fork versions have to earn their place: a pass/fail verdict
   against stated thresholds (core's `has-hsts` is informative, weight 0), plain-English findings, and
   inclusion in the `seo-extended` category. The overlap is recorded in each feature spec.
2. **Link checks wait for the crawler.** "Internal URLs returning 4xx/5xx" and "internal links that
   redirect" need the page's links requested, and the multi-page crawler does not exist yet. They are
   not built here (see Deferred). This is a change from Phase 4's bounded sitemap sample, chosen on
   purpose: a sample of one page's links says little about a site.
3. **Probe requests are allowed**, always on: the `http://` and `www` variants of the audited host, and
   one request to a random nonexistent path (soft-404), all through `src/lib/safe-fetch.js` (SSRF
   protected, status-only, redirects never followed automatically,
   `LHCI_SEO_ALLOW_PRIVATE_NETWORK` applies), a handful of requests in total.

## What Lighthouse core already does (so this is not rebuilt by accident)

| Core audit | Covers | Does not cover |
|---|---|---|
| `is-on-https` | insecure (non-HTTPS) requests on an HTTPS page, allowed or blocked | a verdict per mixed-content type, plain-English impact |
| `has-hsts` | HSTS header: max-age, includeSubDomains, preload (informative, weight 0) | a scored pass/fail threshold |
| `redirects-http` | whether `http://` redirects to `https://` | following the chain, www variants, loops |
| `redirects` | the audited navigation's redirect chain (performance savings) | flagging chains over 2 hops; a redirect loop aborts the whole run (Chrome error) instead of giving a finding |
| `http-status-code` | the audited page's own status | any other URL |
| `crawlable-anchors`, `is-crawlable` | anchor form; the page's own indexability | whether links resolve |

Not in core at all: certificate expiry, host-variant consistency, soft-404 detection.

## Features

| # | Feature | Status | Slug / notes |
|---|---------|--------|--------------|
| 1 | Mixed-content detection | **done** | `transport-security`, audit `mixed-content`. QA'd live, see `docs/qa/transport-security.md`. Active content or anything blocked fails; passive upgraded content is a note. Reads `DevtoolsLog` + `InspectorIssues`; no new gatherer, no new requests. |
| 2 | HSTS header presence and quality | **done** | `transport-security`, audit `hsts-quality`. Fails on no header, `max-age` missing/0/under one year, or `preload` without its prerequisites. |
| 3 | SSL certificate validity / expiry warning | **done** | `transport-security`, audit `ssl-certificate-expiry`. Reads `securityDetails` (`validFrom`/`validTo`) from the raw `Network.responseReceived` events in the `DevtoolsLog`; no outbound request. Scores 1 / 0.5 (15 days or fewer, with a warning) / 0; an already-expired certificate normally aborts the run, so the warning band is the real value. |
| 4 | HTTP → HTTPS → www normalization consistency, plus redirect chains over 2 hops and loops (for the host variants) | **done** | New gatherer `UrlVariants` (outbound probes), built after a short design conversation, then lightweight code; three audits `url-variant-consistency`, `redirect-chain-length`, `redirect-loop`, QA'd live: see `docs/qa/url-variants.md`. Chains and loops are followed manually with a hop cap, only for the audited URL's own `http`/`https`/`www`/non-`www` variants, never for the page's links. |
| 5 | Soft-404 detection | **done** | audit `soft-not-found` (id is not `soft-404`: see the README and `lighthouse-conventions.md`), gatherer `Soft404Probe`. Built lightweight, independent of item 4. Two made-up URLs (top-level and nested `.html`), one same-origin redirect hop, QA'd live: see `docs/qa/soft-not-found.md`. |

Build order (1-3 and 5 done): 1-3 as one group (no gatherer, no outbound requests; built with the full
pipeline although planned lightweight, see below), item 5 next because it did not depend on item 4, then
item 4 (the host-variant gatherer, short design conversation, then lightweight code): all done.

## How the plan changed while building

- **Items 1-3 ran the full 9-stage pipeline**, not the lightweight mode planned for them. Not needed for
  concrete checks that read existing artifacts; item 5 was built lightweight, and item 4 will be a short
  design conversation then lightweight code.
- **Item 5 did not depend on item 4** (a soft-404 probe is two status requests to made-up paths), so it was
  built first as its own gatherer instead of extending item 4's.
- **The audit id is `soft-not-found`**: live `lhci assert` showed that an id with a hyphen followed by a
  digit (`soft-404`) makes every assert run fail on a phantom `soft404` audit (an LHCI quirk).

- **Item 4's three roadmap rows became three audits on one gatherer** (consistency, chain length, loop), chosen with the developer so severities can differ (loops `error`, chains `warn`). Decisions made in the design conversation: probe the audited page's path and query (so a redirect that drops the path is caught), and a temporary redirect (302/307) is a note, not a failure. Added without a separate question, stated in the README: no `www` toggle for subdomains (wildcard DNS false positives), and no probing for IPs, `localhost`, non-default ports or non-HTTPS pages.

## Deferred

| Item | Deferred | Why |
|---|---|---|
| Internal URLs returning 4xx/5xx | to the multi-page crawler | needs the page's links (and ultimately the whole site's) requested; developer chose not to ship a one-page sample (2026-10-01) |
| Internal links that redirect instead of resolving directly | to the multi-page crawler | same |
| Redirect chain / loop detection **on internal links** | to the multi-page crawler | item 4 covers chains and loops for the audited URL's host variants only |

## To do later

| Item | When | Notes |
|---|---|---|
| Soft-404 content heuristics ("not found" wording on a 200 page) | after the crawler | the `soft-not-found` probe detects a site that answers made-up paths with 200; per-page heuristics need many pages |

## Not possible / permanently out of scope

None identified yet.
