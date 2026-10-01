# QA checklist: URL variants (`url-variant-consistency`, `redirect-chain-length`, `redirect-loop`)

- slug: url-variants
- merged: see git log (into `phase-5-crawlability`, ff-only, lightweight mode after a short design conversation)

Covers the `UrlVariants` gatherer and the three audits reading it. Verified with the real gatherer and real
`lhci assert`/Lighthouse runs against seven public sites and ten planted scenarios (real HTTP and HTTPS
servers, real `Location` headers; the hostnames were mapped to local ports by a thin fetch wrapper because
the variants must use ports 80 and 443, which a QA run cannot bind), not only unit tests. The
SSRF-protected fetch itself was exercised against the public sites.

## Functional

- [x] **Correct setup** (planted): every form redirects once with a 301 to the audited URL: all three
      audits score 1.
- [x] **Serves directly** (planted, and real: `example.com`, `www.google.com`): `url-variant-consistency`
      score 0, "Serves the page directly (HTTP 200) instead of redirecting: the same content is reachable at
      two URLs".
- [x] **Long chain** (planted: 3 redirects; real: `stripe.com` 3 redirects incl. a geo hop):
      `redirect-chain-length` score 0 while consistency still passes (each audit fails only its own problem).
- [x] **Loop** (planted, two URLs bouncing): `redirect-loop` score 0, the table shows "back to <url>"; the
      other two audits do not double-fail.
- [x] **Path dropped** (planted: everything redirected to `/`): consistency score 0, "the path and query of
      the requested URL were not preserved".
- [x] **Ends in an error** (planted), **ends at the wrong origin** (planted: stays on `http://www`): consistency 0.
- [x] **Temporary redirects** (planted 302s): consistency passes, the row says "through a temporary
      redirect (302/303/307)".
- [x] **Real passing sites**: `github.com` (including a 2-redirect `www` form), `nodejs.org` (308/307),
      `react.dev`, `developer.mozilla.org`: all three audits score 1.

## Edge cases and hostile servers

- [x] **Redirect to another site** (planted: a CDN host and `http://127.0.0.1:9399/...`): recorded as
      "not one of this site's own host variants", **never requested** (a spy server on that port got zero
      requests), not judged.
- [x] **A form that does not exist** (planted apex-only site: the `www` names fail DNS): "Not reachable ...
      there is no such variant"; the audit passes on the remaining form.
- [x] **Skipped pages** (real Lighthouse run on `https://localhost:8991`): all three audits not applicable
      with "the page uses a non-default port (8991) ..." and no run warning. Unit: `http://` pages, IPs,
      `localhost`, `*.localhost`, IPv6 literals.
- [x] **Subdomains** (real: `developer.mozilla.org`): only `http://` of the same host is probed, no
      `www.developer.mozilla.org`.
- [x] Unit (50 tests): variant planning, every judgement, boundary of 2 vs 3 redirects, hop limit of 5,
      loops including redirect-to-self ignoring the fragment, a redirect to an allowed host on a different
      port is not followed, missing/invalid/`file:`/`javascript:` `Location`, per-variant time budget,
      enormous error text and URLs cut, missing/skipped/empty artifacts never throw.
- [ ] **Not exercised live**: a server that hangs (unit-tested with a fake clock) and a private-address
      refusal for a non-localhost name (unit-tested).

## Integration

- [x] **End to end**: real Lighthouse runs with the fork config: `github.com` 1/1/1, `example.com`
      consistency 0 with three rows, localhost not applicable.
- [x] **`lhci assert`, real run** on `example.com`: `url-variant-consistency` as `error` prints the failure
      and exits 1, with **no phantom assertions** (the audit-id rule from soft-not-found: these ids have no
      hyphen before a digit, and the config test guards it).
- [x] **Config**: registered through `configPath` alone (gatherer `UrlVariants`, three audits at weight 1,
      38 in the category); no new config key or environment variable (it uses the existing private-network
      opt-in).
- [ ] `packages/viewer` rendering was **not** checked; `npm run start:seed-database` was **not** run.

## Findings

- None against the audits. Observations: geo or locale redirects (`stripe.com`) count toward the chain
  length and make the chain audit fail, which is stated in the README; `example.com` and
  `www.google.com` really do serve plain `http://` directly, so the consistency audit flags them (correct by
  its definition).
