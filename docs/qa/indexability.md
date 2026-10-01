# QA checklist: Indexability (`indexability-verdict`, `indexability-conflicts`)

- slug: indexability
- merged: not yet (branch `feat/indexability`, lightweight mode after a short design conversation, to merge into `phase-6-indexability`)

Covers the `IndexabilitySignals` gatherer and the two audits reading it. Verified with real Lighthouse and
`lhci assert` runs against a local server with planted pages (using `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`
for the canonical-target request) and six public sites, not only unit tests.

## Functional (real Lighthouse runs on planted pages)

- [x] **Clean pages** (self canonical, no canonical): verdict "Indexable", conflicts score 1.
- [x] **noindex alone** (meta): verdict "Not indexable (noindex)", conflicts score 1 (a deliberate noindex is
      not a contradiction).
- [x] **noindex + canonical elsewhere**: conflicts score 0, "noindex, but the canonical points to ...".
- [x] **noindex hidden by robots.txt** (`X-Robots-Tag: noindex` on a page robots.txt disallows): score 0,
      "noindex, but robots.txt blocks Googlebot and Bingbot"; verdict "Not indexable (noindex)" and the
      explanation points to `indexability-conflicts`.
- [x] **robots.txt blocks a page whose canonical points elsewhere**: score 0; verdict "Blocked by robots.txt".
- [x] **Canonical target problems** (one request each): a target returning **404**, a target that
      **redirects** (301, the row names where), a **noindex** target, a **canonical chain**, and a target
      **blocked by robots.txt**: all score 0 with their own row. A healthy target (`canon-ok`) scores 1 and the
      verdict row says "Target checked: HTTP 200, indexable".
- [x] **Cross-origin canonical** (a spy server on another port): verdict "canonical elsewhere", conflicts 1, and
      the spy received **zero** requests: it is never requested.
- [x] **Thin page** (under 100 characters of text): the text step flags it, the verdict stays "Indexable".
- [x] **Public sites**: `example.com` (no robots.txt, no canonical), `github.com`, `nodejs.org`,
      `developer.mozilla.org`, `react.dev`: verdict "Indexable", conflicts 1, with the five steps filled in.
      `www.google.com`: "Blocked by robots.txt": correct for the URL Chrome reports,
      `https://www.google.com/?zx=...` (a query Google adds after load), which Google's robots.txt disallows with
      `Disallow: /?`.

## Edge cases

- [x] **A 404 main document**: Lighthouse stops with `ERRORED_DOCUMENT_REQUEST` and writes no audit results (so
      the HTTP-4xx verdict and the error-page conflict are unreachable by default). With
      `settings.ignoreStatusCode: true` the run continues with a warning and the audits give "Not indexable (HTTP
      404)" and "HTTP 404 page that declares a canonical" (score 0). Documented in the README and the tracker.
- [x] Unit (44 tests): canonical classification (fragment, trailing slash, relative, conflicting), robots.txt
      per crawler, every verdict and ranking, every conflict and its negative cases (noindex for the allowed
      crawler, self and trailing-slash canonical, several canonicals), target problems and notes, a target
      that could not be requested or was only partly read is a note, enormous URLs cut, missing or unknown
      status is not applicable, and a gatherer test that no request is made for a missing, self, trailing-slash,
      cross-origin (host, port, scheme, metadata address), non-http or several canonicals.
- [x] **Without the private-network opt-in** the target request to `localhost` is refused and recorded as a note
      on the verdict row, not a failure (covered by the "could not be requested" tests).
- [ ] **Not exercised live**: a canonical target that hangs (unit: a failed request is data) and a noindex
      added by JavaScript after load (stated limit).

## Integration

- [x] **`lhci assert`, real run** on the noindex + canonical page: `indexability-conflicts` as `error` prints one
      failure and exits 1; `indexability-verdict` as `warn` produces nothing (informative audits normalize to 1);
      no phantom assertions (the ids have no hyphen before a digit).
- [x] **Config**: registered through `configPath` alone (gatherer `IndexabilitySignals`, two audits at weight 1,
      40 in the category); no new config key or environment variable.
- [ ] `packages/viewer` rendering was **not** checked; `npm run start:seed-database` was **not** run.

## Findings

- None against the audits. **A QA-process error, caught and corrected**: an early "reachable?" check of a 404
  page read a stale result file from the previous run (my wrapper config failed silently); the runner now
  deletes its output before each run and reports a missing file, and every scenario above was re-run after
  that fix.
