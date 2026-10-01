# Audit spec: Transport Security

- slug: transport-security
- upstream-sync checked against: lighthouse@12.6.1 (installed; `@lhci/utils` is this workspace's own 0.1.0). Core ships `is-on-https`, `has-hsts`, `redirects-http`, `redirects`; none changed shape since the fork's earlier audits, and `Audit`, `MainResource` and the `DevtoolsLog` / `InspectorIssues` artifacts are the same ones the Phase 1 and Phase 4 audits already use. No upstream pull since the last audit was added, so no changelog range to scan.

Three audits, one source: the `DevtoolsLog` Lighthouse already records, plus its core `InspectorIssues`
artifact. No new gatherer, no outbound request.

## Verified before designing (real run, 2026-10-01)

Ran the installed Lighthouse (`-G`, gather only) against `https://example.com` and read the saved
`defaultPass.devtoolslog.json`:

- The raw `Network.responseReceived` event for the main document carries
  `response.securityDetails` with `validFrom` and `validTo` (Unix seconds), `issuer`, `subjectName`.
  This closes the spec's first open question: the certificate audit has a data source.
- `securityDetails` is **not** on the parsed network record (`lib/network-request.js` does not keep it),
  so the audit must read the raw log entry matching the main document's `requestId`.
- Core's `InspectorIssues.mixedContentIssue[]` gives, per insecure reference, `insecureURL`,
  `resourceType` (Script, Stylesheet, Image, Frame, Form, ...) and `resolutionStatus`
  (`MixedContentBlocked`, `MixedContentAutomaticallyUpgraded`, `MixedContentWarning`). The per-request
  `request.mixedContentType` field in the log was `none` for every request, so it is not usable.
- Not verified: a live page with real active mixed content (the public test page `mixed.badssl.com`
  has since been fixed). The mixed-content classification will be tested against a local fixture server
  in QA instead.

## Gatherer

- New gatherer: none (reusing core's `DevtoolsLog`, `InspectorIssues`, `URL`).
- Data collected: main document response headers and `securityDetails`; insecure references and how
  Chrome resolved each; the final main-document URL's scheme.
- Collection method: nothing new; `MainResource` (computed artifact, as `robots-sources.js` already
  does) for the main document's record and headers, and a scan of the raw `DevtoolsLog` for the
  `Network.responseReceived` entry with the same `requestId` for `securityDetails`.

Code layout follows the existing split: `src/lib/transport-security-sources.js` imports `MainResource`
(not loadable under Jest), and `src/lib/transport-security.js` holds the pure logic (HSTS parsing,
mixed-content classification, certificate status), fully unit-testable.

All three audits are `supportedModes: ['navigation']` and **not applicable** when the final main
document URL is not `https:`.

## Audit 1: `mixed-content`

- Audit id: `mixed-content`
- Requires: `DevtoolsLog`, `InspectorIssues`, `URL`
- Inputs: every `mixedContentIssue` plus every network record whose scheme is `http:` while the page is
  HTTPS (the "allowed" ones core also finds), de-duplicated by URL.
- Classification (decided with the developer: **active or blocked fails; passive is a note**):
  - **Active**: Script, Stylesheet, Frame, Worker, SharedWorker, ServiceWorker, Import, XSLT,
    XMLHttpRequest, EventSource, Font, Form, Beacon, Ping, CSPReport, Prefetch, Download, Manifest,
    AttributionSrc, Resource and any type not listed (unknown defaults to active: the safe direction).
  - **Passive**: Image, Audio, Video, Track, Favicon, PluginData, PluginResource.
  - **Blocked** (any type): `resolutionStatus` is `MixedContentBlocked`.
- Scoring: `score = 0` if any item is active or blocked; otherwise `1`. Passive items that Chrome
  auto-upgraded (`MixedContentAutomaticallyUpgraded`) or allowed with a warning are listed and counted
  in the `displayValue` but do not fail ("works today, but the source still says http://").
- Failure threshold: one active or blocked item.
- `DetailsType`: table; columns `url`, `type`, `kind` (Active / Passive), `resolution` (Blocked /
  Auto-upgraded / Allowed), `impact` (one plain-English sentence per row, e.g. "Blocked by the browser:
  the script did not run, so whatever depends on it is broken"). Sorted active first, capped at 50 rows
  with a "N more not shown" note.
- Difference from core's `is-on-https` (stays in the report): classifies active vs passive, fails only
  where the page is actually at risk, and explains the impact.

## Audit 2: `hsts-quality`

- Audit id: `hsts-quality`
- Requires: `DevtoolsLog`, `URL`
- Input: the main document's `Strict-Transport-Security` header values.
- Parsing: RFC 6797. If the header appears more than once, only the **first** is evaluated (the RFC
  says a user agent must process only the first); the duplicate is reported as a note. Directive names
  case-insensitive; `max-age` quoted or unquoted.
- Scoring: `score = 0` when any of: header absent; `max-age` missing or not a non-negative integer;
  `max-age=0` (explicitly turns HSTS off); `max-age` below 31 536 000 (one year); `preload` present
  but `includeSubDomains` absent or `max-age` below one year (the preload list would reject it).
  Otherwise `1`.
- Notes (never fail): `includeSubDomains` absent; `preload` absent; more than one header.
- `DetailsType`: table; columns `directive`, `value`, `finding`; one row per problem or note, or a single
  "present and sufficient" row.
- Difference from core's `has-hsts` (stays in the report, informative, weight 0): this one has a
  pass/fail threshold and counts toward the extended category.
- Limit stated in the description: an HSTS header is only honoured over HTTPS and only after a first
  HTTPS visit; the audit does not check the preload list or subdomains.

## Audit 3: `ssl-certificate-expiry`

- Audit id: `ssl-certificate-expiry`
- Requires: `DevtoolsLog`, `URL`
- Input: `securityDetails.validTo` (and `validFrom`) of the main document's response.
- Scoring (decided with the developer: **fail on expiry, notify when 15 days or fewer remain**; the 0.5 mapping is this design's way of making "notify" visible to CI, for Gate 1 to confirm):
  - `validTo` in the past, or `validFrom` in the future: `score = 0`.
  - 15 days or fewer remaining: `score = 0.5` (the report shows it amber) with a **warning**
    (`warnings[]` on the result) and the days in `displayValue`. A partial score is deliberate: `lhci
    assert` can only gate on `minScore`/`maxNumericValue` (there is no `minNumericValue`), so 0.5 is the
    only way CI can tell "expiring soon" from "fine" and from "expired".
  - More than 15 days: `score = 1`.
  - No `securityDetails` on the response (a cached/resumed connection, or none reported): not
    applicable, with an explanatory note rather than a guess.
- "Now" is the run's own fetch time (`artifacts.fetchTime`) so a saved artifact set re-audits
  deterministically.
- `DetailsType`: table with one row: `subject`, `issuer`, `validFrom`, `validTo`, `daysRemaining`.
- Real-world limit, stated in the description and README: Chrome refuses to load a page whose
  certificate has already expired and Lighthouse then aborts the run (an interstitial error), so the
  "expired" failure is reachable only when certificate errors are ignored (a CI flag). In practice this
  audit's value is the **warning band** before that happens.

## Category placement

- Category: existing fork category `seo-extended` (already registered in `src/lighthouse-config.js`).
- Weight within category: 1 each, like every other audit in it. Core's `best-practices` category is
  untouched.

## Extension point

`packages/seo-audits/src/lighthouse-config.js`, the custom Lighthouse config referenced through
`.lighthouserc.js` `ci.collect.settings.configPath` (`extends: 'lighthouse:default'`). Three entries go
into its `audits` array and `seo-extended.auditRefs`; no `artifacts` entry is added (that is why
`plugins` would also have worked here, but the fork's single config keeps one mechanism).
`test/lighthouse-config.test.js` is updated (thirty-one to thirty-four audits).

## Risks / open questions

- `InspectorIssues` only reports mixed content Chrome raised an issue for during the run. Requests
  made after the load settles, or issues Chrome de-duplicates, can be missed; the audit says "found
  during this load" and the limit goes in the README.
- Un-upgraded passive requests (`http://` images on a page where the browser does not upgrade) appear
  only through the network records; both sources are merged by URL so one URL is one row.
- On an `http://localhost` page Chrome treats the origin as secure; the audits are not applicable there
  (page scheme is not `https:`), which matches the CI use case without special handling.
- A certificate from a staging environment (self-signed, CI run with `--ignore-certificate-errors`) is
  evaluated like any other: same dates, same rule.
- Edge: a redirect from `http://` to `https://` makes the **final** URL the HTTPS one, so the checks
  apply; if the final URL is `http:`, all three are not applicable.
- HSTS multiple-header handling and the one-year/preload thresholds are this design's decisions (not
  separate questions to the developer); they are listed here so Gate 1 can overrule them.
