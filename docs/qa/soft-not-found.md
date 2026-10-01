# QA checklist: Soft-404 check (`soft-not-found`)

- slug: soft-not-found
- merged: not yet (branch `feat/soft-404`, lightweight mode, to merge into `phase-5-crawlability`)

Covers the `soft-not-found` audit and the `Soft404Probe` gatherer. Verified with real Lighthouse and
`lhci assert` runs against local servers with planted behaviours (using
`LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`) and seven public sites, not only unit tests.

## Functional

- [x] **Correct 404 site** (local): score 1; both rows "Returned HTTP 404 (correct)".
- [x] **Catch-all / single-page app** (everything 200): score 0, "2 of 2 made-up URL(s) were answered as
      a normal page instead of 404 or 410"; both rows "Returned HTTP 200 ... soft 404".
- [x] **Unknown URLs redirect to `/`** (302 to a 200 page): score 0; rows "Redirects to
      http://localhost:9103/, which returns HTTP 200 ... soft 404" (one hop followed, status only).
- [x] **Redirect to a same-origin page that 404s**: score 1 (`redirect-to-error`).
- [x] **Public sites**: example.com, github.com, nodejs.org, developer.mozilla.org, www.google.com,
      react.dev and stripe.com all score 1 (404 on both probes), 70 ms to 1 s.

## Edge cases and hostile servers (run against the real gatherer and `safeFetchStatus`)

- [x] **Redirect to another origin** (a spy server on a different port): classified `redirect-elsewhere`,
      score 1, and the spy received **zero** requests: an off-origin redirect is never requested.
- [x] **Redirect loop** (unknown path redirects to itself): exactly one extra request, `redirect-chain`
      (not judged), no loop.
- [x] **Server that never answers** on unknown paths: both probes cut at **5 s** (5.0 s total because they
      run in parallel), audit not applicable with the reason.
- [x] **500 on unknown paths**: shown as a server error, does not fail.
- [x] **60 KB `Location` header**: Node's parser rejects the response ("Header overflow"); recorded as a
      failed probe, no crash, not applicable.
- [x] **Private-network policy**: without `LHCI_SEO_ALLOW_PRIVATE_NETWORK` a `localhost` page gets
      `notApplicable`, and the run carries the warning "The soft-404 check was skipped: refusing to connect
      to "localhost" ... set LHCI_SEO_ALLOW_PRIVATE_NETWORK=1."
- [x] Unit (36 tests): every status class, scheme/port/host/scheme-relative off-origin redirects,
      missing/invalid/`file:`/`javascript:` `Location`, enormous `Location` and error text, failed second
      hop, one probe failing, random token differs per call, missing or empty artifact never throws.

## Integration

- [x] **`lhci assert`, real run**: `'soft-not-found': ['error', {minScore: 1}]` on the catch-all result prints
      "failure for minScore assertion" and exits 1; the correct site produces no output and the run passes.
- [x] **Config**: registered through `configPath` alone (gatherer `Soft404Probe`, audit `soft-not-found`,
      weight 1, 35 audits); no new config key or environment variable (it uses the existing private-network
      opt-in).
- [ ] `packages/viewer` rendering was **not** checked; `npm run start:seed-database` was **not** run.

## Findings

- **Found in live QA, fixed before merge: an audit id with a hyphen followed by a digit breaks
  `lhci assert`.** The first version was called `soft-404`. A real `lhci assert` printed a second,
  phantom failure, "`soft404` is not a known audit", on every run, including for a site that passed: LHCI
  expands each hyphenated assertion key into a camelCase alias and removes aliases by comparing with a
  kebab-case conversion that inserts no hyphen before digits (reproduced with `yargs-parser`:
  `soft-404` gives `soft404`). Unit tests could not have found it. The audit is now `soft-not-found`, a
  guard test in `lighthouse-config.test.js` fails on any registered id matching `/-\d/`, and the rule is in
  `.ai-agents/prompts/lighthouse-conventions.md`. The cause is in LHCI's own assertion code, which this fork
  does not edit.
