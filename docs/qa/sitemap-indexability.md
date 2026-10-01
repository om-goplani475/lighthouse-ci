# QA checklist: Sitemap vs Indexability

- slug: sitemap-indexability
- merged: 593f514 (into `phase-4-robots-sitemap`, ff-only; `base_commit` 58c6a52)

Covers the new `sitemap-indexability` audit, the page sample added to the `SitemapDocuments`
gatherer, and the refactor of `sitemap-url-status` onto it. Verified with real `lhci collect` /
`lhci assert` runs (public sites and a local site with planted defects, using
`LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`), not only unit tests.

## Functional

- [x] **Planted defects, local site** (11 listed URLs): `score: 0`, "5 noindex, 2 with a canonical
      pointing elsewhere among 9 judged URL(s)". Rows: `<meta name="robots" content="noindex, follow">`
      names Googlebot and Bingbot; `<meta name="googlebot" content="noindex">` names Googlebot only;
      `X-Robots-Tag: noindex` names both via the header; `X-Robots-Tag: bingbot: noindex` names
      Bingbot only; a **PDF** with `X-Robots-Tag: noindex` is caught from its header alone; a canonical
      to another path fails; a relative canonical `/fine?x=1&amp;y=2` is resolved and its `&amp;`
      decoded (`canonical points to http://localhost:8881/fine?x=1&y=2`).
- [x] **Not failures, shown as notes** (same run): a canonical that differs only by a trailing slash;
      a page whose `<head>` runs past 64 KiB ("1 page(s) had their <head> only partly read, so no
      noindex is not proof": the noindex meta sits after 84 KB of inline CSS and is correctly *not*
      claimed as absent); the PDF ("1 non-HTML page(s): only their X-Robots-Tag header was checked");
      the 404 ("did not return 2xx ... see sitemap-url-status").
- [x] **A real find, public site**: `https://developer.mozilla.org/en-US/`: 10 of 52,383 listed URLs
      sampled; `sitemap-indexability` `score: 0`, `https://developer.mozilla.org/zh-TW/search` is listed
      in MDN's own sitemap but is `noindex` (`<meta name="robots">`). `sitemap-url-status` scores 1 on
      the same sample (all return 200): the two audits report different things, as designed.
- [x] **Pass**: `https://nodejs.org/en`: every sampled 2xx page indexable; `sitemap-indexability`
      `score: 1`, "Checked 5 of 1732 listed URLs (a sample). 5 sampled URL(s) did not return 2xx or
      were not checked (see sitemap-url-status)": it does not double-report what `sitemap-url-status`
      already fails.

## Edge cases

- [x] Non-2xx, redirected, errored and not-checked pages are never judged, even with a noindex header
      (unit); a sample with no 2xx page is `notApplicable`; discovery `none`/`unavailable` and a
      missing, `null` or empty `urlSample` are `notApplicable` and never throw (unit)
- [x] Canonical rules (unit): fragment ignored, scheme/host case ignored, relative and `//` hrefs
      resolved against the page, root with or without a slash equal; `http` vs `https`, `www`, another
      host, another port, path case, and a query string each fail; several *different* canonicals are
      noted, not judged; the same canonical repeated is one canonical; an unresolvable href is ignored
- [x] noindex rules (unit): `none` counts; non-blocking directives, a scope for another crawler and
      `max-snippet: 20` / `unavailable_after: <date>` are not mistaken for a block or a scope; each
      header occurrence is read on its own; the existing `robots-directives-*` audits are untouched
- [x] A noindex hidden in a comment, a `<script>` string, `<noscript>` or `<template>`, or placed in the
      body, is **not** counted; a signal ahead of a 3,000-tag flood is kept and the head is marked
      incomplete (unit, and re-run in the security review)
- [x] **Hostile HTML** (found and fixed during the build, see the security review): 64 KiB of nested
      `<div>` took **1.6 s** to parse and ~a dozen other block elements behave the same; with the
      2,000-tag limit the worst of 121 element names is 83-92 ms. Nine of the ten timing tests fail
      without the limit.
- [x] Bodies not read: non-HTML, compressed (`Content-Encoding`), non-2xx: headers still returned;
      the body cap, a never-ending body, a stalled body, slow headers, and a reset after headers
      (real local server, 143 tests in `safe-fetch.test.js`)
- [x] Report size: rows capped at 20 with the true total in the explanation (unit)
- [ ] Not exercised live: a compressed page on a real site, a real page whose `Content-Type` is
      `application/xhtml+xml`, and `X-Robots-Tag` set by a real CDN. Covered by unit and local-server
      tests only.

## Integration

- [x] Appears in the `seo-extended` category (weight 1); `lighthouse-config.test.js` asserts all 31
      audit ids and the `SitemapDocuments` artifact resolve. On nodejs.org the category scores 0.84
      with every sitemap-related audit present.
- [x] `lhci assert` enforces the suggested severity, against the local planted-defect site:
      `'sitemap-indexability': ['warn', {minScore: 1}]` prints a warning and **exits 0**;
      `['error', {minScore: 1}]` fails and **exits 1**.
- [x] No new `.lighthouserc.js` keys; `LHCI_SEO_SITEMAP_SAMPLE_SIZE` and
      `LHCI_SEO_ALLOW_PRIVATE_NETWORK` keep their meaning and now also govern the page requests
- [x] `parse5@^7.1.1` declared; `yarn install --frozen-lockfile` passes with no lockfile change; the
      audit loads under real Node ESM (config test) and under Jest's CommonJS transform
- [ ] Not checked: rendering in `packages/viewer` (nothing there changed; the audit uses the standard
      `table` details type)

## Regression

- [x] **`sitemap-url-status` is unchanged** by the refactor: a characterization test pins its exact
      output for 16 scenarios (2xx mix, nodejs-style 404s, a redirect with its target, a retry,
      5xx/204, the time budget, other-host URLs, de-duplication across files, sample size 4 / 500 / a
      non-number, and every not-applicable case). The expected values were captured from the audit
      *before* the refactor and are byte-identical afterward (diffed); only how a scenario is fed to the
      audit changed. The refactored audit imports no fetch code (tested).
- [x] **Live, nodejs.org**: before the refactor 5 of 10 sampled URLs returned 404, `score: 0`; after, the
      same: "5 of 10 sampled URL(s) did not return 200. Checked 10 of 1732 listed URLs (a sample)."
- [x] The other sitemap audits on nodejs.org after the change: `sitemap-valid` 1,
      `sitemap-duplicate-urls` 1, `sitemap-limits` 1, `sitemap-robots-crossref` 1,
      `llms-txt-structure` 1: unchanged from their earlier QA.
- [x] seo-audits suite: **808 tests pass** (54 suites); repo-wide `npm run test:typecheck` and
      `npm run test:lint` exit 0. New or changed tests: `html-head-signals` 45, `robots-directives` 29
      (12 new for `noindexFor`), `safe-fetch` 143 (the prefix fetch and its address policy),
      `sitemap-url-sample` 53, `sitemap-documents` gatherer 61 (unit + local-server integration),
      `sitemap-indexability` 39, `sitemap-url-status` 39 (22 rewritten, 17 characterization).
- [x] One deliberate change to existing tests: the gatherer's unit-test helpers now inject a harmless
      page fetcher. Without it, any test whose sitemap lists `https://example.com/...` would have made
      a real request once the gatherer started sampling pages.
- [ ] `npm run test` (all packages): **not run**. An earlier full run had 12 failing suites, mostly the
      Storybook/Puppeteer image tests in `packages/server`; they were never confirmed against the base
      branch (see `.ai-agents/state/ci-backlog.md`). This feature changes nothing outside
      `packages/seo-audits`.
- [ ] `npm run start:seed-database`: not run (needs the server database; unrelated to this diff).

## Observations, not defects

- **A noindex or canonical added by client-side JavaScript is invisible to this audit.** It reads the
  raw HTML head of a plain request. The audit's own description says so.
- **The page sample adds up to ~30 s to the gatherer** when the site is slow (measured 30.1 s with 25
  pages that never answer, with the 10 pages the budget did not reach reported as not checked). Combined
  with the sitemap documents the worst case is ~135-145 s; see security Finding 6.
- **`sitemap-url-status` still scores 1 when the time budget leaves most URLs "not checked"** (9 of 10 in
  the pinned scenario, with a note). That is the pre-existing behavior, pinned unchanged by the
  characterization test; it is worth revisiting separately.
- **`lhci assert` passes when there is no result to check.** A `collect` that fails to produce a report
  (for example Chrome refusing an interstitial) followed by `assert` prints "All results processed!"
  and exits 0. Found by accident while testing; it is `lhci`'s behavior, not this fork's, but a CI job
  should run `collect` and `assert` as one failing pipeline (`lhci autorun` does).
