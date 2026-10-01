# Phase 5 — Crawlability & Status Codes

Live tracker for this phase's work in `packages/seo-audits`. Branch: `phase-5-crawlability` (off
`main`), the fourth phase to use the phase-branch workflow in `AGENTS.md`. Merges into `main` only once
every item is done, deferred, to-do-later, or marked not possible.

Status values: **done** (merged + QA'd live) · **in progress** · **planned**.

**Status: planned (2026-10-01).** Scoping done with the developer; nothing built yet.

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
| 1 | Mixed-content detection | planned | `transport-security`, audit `mixed-content`. Reads the existing `DevtoolsLog`; no new gatherer, no new requests. |
| 2 | HSTS header presence and quality | planned | `transport-security`, audit `hsts-quality`. Reads the main document's response headers from the `DevtoolsLog`. |
| 3 | SSL certificate validity / expiry warning | planned | `transport-security`, audit `ssl-certificate-expiry`. Reads `securityDetails` (`validFrom`/`validTo`) from the raw `Network.responseReceived` events in the `DevtoolsLog`; no outbound request. |
| 4 | HTTP → HTTPS → www normalization consistency, plus redirect chains over 2 hops and loops (for the host variants) | planned | New gatherer `UrlVariants` (outbound probes, full pipeline). Chains and loops are followed manually with a hop cap, only for the audited URL's own `http`/`https`/`www`/non-`www` variants, never for the page's links. |
| 5 | Soft-404 detection | planned | Probes one random nonexistent path on the origin; a 200 (or a redirect to a 200) instead of a 404/410 is the finding. Extends the item-4 gatherer. |

Build order: 1-3 as one lightweight-mode group (no gatherer, no outbound requests), then item 4 (the
gatherer, full pipeline), then item 5.

## Deferred

| Item | Deferred | Why |
|---|---|---|
| Internal URLs returning 4xx/5xx | to the multi-page crawler | needs the page's links (and ultimately the whole site's) requested; developer chose not to ship a one-page sample (2026-10-01) |
| Internal links that redirect instead of resolving directly | to the multi-page crawler | same |
| Redirect chain / loop detection **on internal links** | to the multi-page crawler | item 4 covers chains and loops for the audited URL's host variants only |

## To do later

| Item | When | Notes |
|---|---|---|
| Soft-404 content heuristics ("not found" wording on a 200 page) | after the crawler | the probe in item 5 detects a site that answers every path with 200; per-page heuristics need many pages |

## Not possible / permanently out of scope

None identified yet.
