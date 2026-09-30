# Task sequence: Sitemap vs Indexability

- slug: sitemap-indexability

Branching: `feat/sitemap-indexability` off `phase-4-robots-sitemap`; Gate 3's merge target is the phase
branch (per `AGENTS.md`'s "Phase branches"). Every task's `scope_whitelist` is inside
`packages/seo-audits`, so none is flagged higher-risk; nothing touches `packages/utils` or `packages/cli`.
Each task carries its own tests so every commit leaves the suite green.

**This feature modifies merged, live-verified code** (`sitemap-url-status`, `safe-fetch.js`,
`robots-directives.js`, `sitemap-url-sample.js`, the `SitemapDocuments` gatherer). The order is chosen so
that (a) everything additive lands first, (b) task-06 pins `sitemap-url-status`'s current output
*before* anything touching it changes, and (c) the refactor (task-10) must pass that same pinned output
unchanged. If task-10 cannot pass task-06's expectations, the refactor is wrong; do not edit the
expectations.

Security note for the implementer: tasks 04 and 09 add outbound-fetch behavior and must follow
`.ai-agents/prompts/security-checklist.md`; neither may add any way for a caller to weaken the address
policy (`isBlockedAddress` is the only decision point). Task 02 parses attacker-influenced HTML: it
needs adversarial fixtures and a timing test.

## Tasks

### task-01: Declare the `parse5` dependency

- scope_whitelist: [packages/seo-audits/package.json]
- depends_on: none
- description: Add `"parse5": "^7.1.1"` to `dependencies` (alphabetical). Confirm the installed 7.1.2
  satisfies it and that `yarn install --frozen-lockfile` still passes because `yarn.lock` already has the
  `parse5@^7.1.1` range; if yarn wants to change the lockfile, stop and report instead of committing it.
- commit_message: "chore(seo-audits): declare parse5 dependency for HTML head parsing"

### task-02: HTML head signal extraction

- scope_whitelist: [packages/seo-audits/src/lib/html-head-signals.js, packages/seo-audits/test/lib/html-head-signals.test.js]
- depends_on: task-01
- description: New pure module per the contract. `extractHeadSignals(body, {truncated})` decodes UTF-8,
  `parse5.parse`s, and reads `<head>` children only: `<meta name=robots|googlebot|bingbot>` as
  `{name, content}` (lowercased name, content capped at 1,000 chars, at most 20) and every
  `<link rel~=canonical>` href (whitespace-split, case-insensitive rel tokens, at most 5, empty dropped);
  `headComplete` is `!truncated || body has content`. Never throws. **First check in this task**: that
  `parse5` imports under Jest's CommonJS transform (its `dist/cjs` entry); if it does not, stop and
  report. Tests: name and rel case, unquoted and single-quoted attributes, `&amp;` in an href decoded,
  `rel="canonical alternate"`, `<meta>`/`<link>` in the body ignored, `<meta name=robots>` inside an HTML
  comment / a `<script>` string / `<noscript>` / `<template>` ignored, other meta names ignored, caps
  enforced, empty and non-HTML input, a tag cut off by the prefix limit, `headComplete` cases, and
  **adversarial input**: 64 KiB of nested `<div>`, of misnested `<b><i>` formatting elements, of unclosed
  `<a>`, and of attributes, each parsed in well under a second (a timing assertion with generous margin).
- commit_message: "feat(seo-audits): add HTML head signal extraction"

### task-03: Scoped noindex evaluation

- scope_whitelist: [packages/seo-audits/src/lib/robots-directives.js, packages/seo-audits/test/lib/robots-directives.test.js]
- depends_on: none
- description: Add the exported `noindexFor(crawlers, {metas, xRobotsTag})` per the contract and audit
  spec grammar, **without touching any existing export**. A meta applies if its name is `robots` or the
  crawler's name; its content goes through the existing `parseDirectives` + `blocksIndexing`. Each
  `X-Robots-Tag` occurrence is evaluated on its own: a first colon-part that is a known directive key
  (`index`, `noindex`, `follow`, `nofollow`, `none`, `all`, `nosnippet`, `noarchive`, `notranslate`,
  `noimageindex`, `max-snippet`, `max-image-preview`, `max-video-preview`, `unavailable_after`,
  `indexifembedded`) means unscoped; otherwise it is a user-agent scope over the rest of that value, and
  only `googlebot`/`bingbot` scopes count. Returns only blocked crawlers with a `via` list. Tests:
  unscoped and scoped meta and header, `none` counts, `max-snippet: 20` is not mistaken for a scope,
  `unavailable_after: ...` ignored, a scope for another crawler ignored, several headers evaluated
  separately, case-insensitivity, empty input, and that the two crawlers are reported independently.
  The existing `robots-directives` tests must pass unmodified.
- commit_message: "feat(seo-audits): add scoped noindex evaluation to robots directives"

### task-04: `safeFetchPrefix` in safe-fetch

- scope_whitelist: [packages/seo-audits/src/lib/safe-fetch.js, packages/seo-audits/test/lib/safe-fetch.test.js]
- depends_on: none
- description: Add `fetchPrefixWithLookup(url, lookup, {timeoutMs, maxBytes})` and public
  `safeFetchPrefix(url, options)` per the contract (defaults 5000 ms, 64 KiB). Same URL/scheme validation,
  literal-IP check via `isBlockedAddress`/`literalIpOf`, `safeLookup`, no redirects, and a total
  wall-clock deadline. Sends `Accept-Encoding: identity`. Headers returned are an allowlist
  (`x-robots-tag` from `rawHeaders`, every occurrence; `content-type`; `content-encoding`; `location`).
  Reads the body only for a 2xx HTML (or absent content-type) response with no non-identity
  `Content-Encoding`; otherwise destroys the response and returns `bodyRead:
  'skipped-status'|'skipped-not-html'|'skipped-compressed'` with the headers. Reaching `maxBytes`
  destroys the request and **resolves** with `truncated: true`; a stall after headers resolves the same
  way at the deadline; a failure before headers rejects. Additive only. Tests against a real local server
  with the permissive lookup: HTML read in full, cap truncation resolves (not rejects), 404/redirect
  skip, PDF skip, gzip skip with headers kept, several `X-Robots-Tag` headers all returned, redirect not
  followed, a body that never ends, a stalled body, slow headers rejecting at the deadline, a never-ending
  `text/html`; and through the real default path: a loopback URL refused by default and allowed with the
  opt-in, the metadata address and `[::ffff:a9fe:a9fe]` refused even with the opt-in.
- commit_message: "feat(seo-audits): add safeFetchPrefix to safe-fetch"

### task-05: `urlSample` typedefs

- scope_whitelist: [packages/seo-audits/src/lib/sitemap-parse.js]
- depends_on: none
- description: Add the `SampledPage` and `UrlSample` typedefs and the `urlSample: UrlSample | null` field
  to `SitemapDocumentsArtifact`, exactly as in the contract. Typedefs only; `emptyDocument`/`LIMITS` and
  all behavior unchanged; existing fixture artifacts in tests (which lack the field) must keep
  typechecking and passing.
- commit_message: "chore(seo-audits): add urlSample typedefs to the sitemap artifact"

### task-06: Pin `sitemap-url-status`'s current output

- scope_whitelist: [packages/seo-audits/test/audits/sitemap-url-status.characterization.test.js]
- depends_on: none
- description: Test-only. Runs the **current, unmodified** audit (mocking `safeFetchStatus`, as its
  existing tests do) over a fixed set of scenarios and asserts the **exact** returned objects (`score`,
  `explanation`, `displayValue`, `details.items`), written as literal expected values captured from
  the current code: a 2xx-only sample; a 404 mix like nodejs.org's (5 of 10 → 404, score 0); a redirect
  with its target; a network error after a retry; the time budget marking URLs "not checked"; other-host
  URLs skipped; the sample-size variable at 4 and at 500 (capped to 25); and each not-applicable
  case. Structure the scenarios behind one helper, `runStatusAudit(scenario)`, so task-10 changes only that
  helper's body and **none of the expected values**.
- commit_message: "test(seo-audits): characterize sitemap-url-status before refactor"

### task-07: `checkUrls` passes fetcher fields through

- scope_whitelist: [packages/seo-audits/src/lib/sitemap-url-sample.js, packages/seo-audits/test/lib/sitemap-url-sample.test.js]
- depends_on: task-06
- description: Generalize `checkUrls`/`checkOne` so whatever the injected fetcher resolves is kept under
  `response` on each result, in addition to the existing `status`, `redirectLocation`, `error`,
  `notChecked`. Behavior (concurrency, retry, timeouts, budget, order) is unchanged and every existing
  test passes unmodified. Add tests that extra fields survive, that an error result has no stale
  `response`, and that a retry that succeeds keeps the successful response only.
- commit_message: "refactor(seo-audits): pass extra fetcher fields through checkUrls"

### task-08: `collectUrlSample`

- scope_whitelist: [packages/seo-audits/src/lib/sitemap-url-sample.js, packages/seo-audits/test/lib/sitemap-url-sample.test.js]
- depends_on: task-02, task-04, task-05, task-07
- description: Add `collectUrlSample(documents, {fetchPage = safeFetchPrefix, env, now})` returning
  `UrlSample | null`: `collectEligibleUrls`, `resolveSampleSize(env)`, `pickEvenly`, `checkUrls` with
  `fetchPage`; each `SampledPage` is built from the check plus, for a page whose `bodyRead` is `'html'`,
  `extractHeadSignals(body, {truncated})`; other pages get empty `metas`/`canonicals` and
  `headComplete` false. Raw bodies are never kept. Returns `null` when there is no eligible URL. Tests with
  an injected `fetchPage`: `null` for no eligible URLs; fields mapped for HTML, PDF, compressed and 404
  pages; `xRobotsTag` and `contentType` carried; signals extracted; `sampleSize` reflects the variable;
  `eligibleCount` and `skippedCrossOrigin` correct; not-checked pages carry `notChecked` and no signals;
  no body bytes in the result (assert by serializing).
- commit_message: "feat(seo-audits): add collectUrlSample for sampled sitemap pages"

### task-09: Collect `urlSample` in the `SitemapDocuments` gatherer

- scope_whitelist: [packages/seo-audits/src/gatherers/sitemap-documents.js, packages/seo-audits/test/gatherers/sitemap-documents.test.js, packages/seo-audits/test/gatherers/sitemap-documents.integration.test.js]
- depends_on: task-08
- description: After the documents are collected, when `discovery` is `robots-txt` or `default-location`,
  set `artifact.urlSample = await collectUrlSample(artifact.documents, {fetchPage})`; otherwise `null`.
  `collectSitemapDocuments` gains an injectable `fetchPage` dependency (default `safeFetchPrefix`);
  everything else in the gatherer and its registration is unchanged, and every existing test passes
  unmodified apart from fixture artifacts gaining the field. Tests: sample present with an injected fetcher,
  `null` for `none`/`unavailable`, index children and failed documents not sampled, the env variable
  honored; integration against a real local server with the opt-in: HTML with a meta robots and a canonical
  is extracted, and the default (no opt-in) path records the refusal per page without failing the run.
- commit_message: "feat(seo-audits): collect urlSample in the SitemapDocuments gatherer"

### task-10: Refactor `sitemap-url-status` onto the artifact

- scope_whitelist: [packages/seo-audits/src/audits/sitemap-url-status.js, packages/seo-audits/test/audits/sitemap-url-status.test.js, packages/seo-audits/test/audits/sitemap-url-status.characterization.test.js]
- depends_on: task-06, task-09
- description: Rewrite the audit as a pure function of `artifacts.SitemapDocuments.urlSample`: no import of
  `safe-fetch.js`, no network. Rows are `{url, result: describeCheck(page)}`; `explanation`, `displayValue`,
  the "not checked", "on another host" and sampling notes, the pass/fail rule (2xx only) and every
  not-applicable condition are unchanged; a missing or `null` `urlSample` is not-applicable. Update
  `runStatusAudit` in the characterization test to build the artifact through `collectUrlSample`
  (mocking `fetchPage`) and call the new audit; **the expected values in that file must not change**. Its
  older test file is rewritten to feed artifacts with the same cases. If any characterization expectation
  fails, fix the refactor, never the expectation.
- commit_message: "refactor(seo-audits): read sitemap-url-status from the gatherer artifact"

### task-11: `sitemap-indexability` audit

- scope_whitelist: [packages/seo-audits/src/audits/sitemap-indexability.js, packages/seo-audits/test/audits/sitemap-indexability.test.js]
- depends_on: task-03, task-05
- description: New audit per the audit spec (`requiredArtifacts: ['SitemapDocuments']`, same
  `@ts-expect-error` boundary comments as the other sitemap audits), a pure function of `urlSample`. Judges
  only 2xx pages. noindex fail via `noindexFor(['googlebot','bingbot'], ...)`, naming crawlers and sources.
  Canonical fail: one distinct canonical, resolved against the page URL with the fragment dropped, differing
  by more than a trailing slash (query, scheme, host including `www`, path). Notes, never failures:
  trailing-slash-only, conflicting canonicals, `headComplete` false, non-HTML or compressed 2xx pages
  (header-only), counts of non-2xx pages. Not-applicable without a usable sample. Rows capped at 20 with the
  true total; the description states the raw-HTML-only and sample limitations. Tests cover every case above
  plus relative canonicals, a fragment, an empty href, several `X-Robots-Tag` headers, `none`, a scoped
  header for one crawler, and that a missing `urlSample` does not throw.
- commit_message: "feat(seo-audits): add sitemap-indexability audit"

### task-12: Register the audit in the Lighthouse config

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-11
- description: Add `./audits/sitemap-indexability.js` to `audits` and a weight-1 ref to
  `categories['seo-extended'].auditRefs`; update the header comment and the regression test's expected list
  and count (30 → 31). No artifact change.
- commit_message: "feat(seo-audits): register sitemap-indexability in config"

### task-13: README update

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-12
- description: Document `sitemap-indexability` (what it flags, Googlebot/Bingbot-scoped noindex, canonical
  rules and the trailing-slash note, the sample, only 2xx judged, and the stated limits: raw HTML head only
  so JavaScript-injected tags are invisible, and a partly-read head is a note), the shared page sample (one
  request per URL feeding both audits, 64 KiB per page, same bounds and variables), the suggested `warn`
  severity, and update the audit count. Note that `sitemap-url-status` now reads the shared sample and is
  otherwise unchanged.
- commit_message: "docs(seo-audits): document sitemap-indexability and the shared sample"
