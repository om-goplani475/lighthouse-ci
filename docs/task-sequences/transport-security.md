# Task sequence: Transport Security

- slug: transport-security

Branching: `feat/transport-security` off `phase-5-crawlability`; Gate 3's merge target is the phase
branch (per `AGENTS.md`'s "Phase branches"). Every task's `scope_whitelist` is inside
`packages/seo-audits`, so none is flagged higher-risk; nothing touches `packages/utils` or
`packages/cli`. Purely additive: no existing file changes except `src/lighthouse-config.js`, its test,
and the README. Each task carries its own tests so every commit leaves the suite green.

Testing shape (same constraint as `robots-sources.js`): anything importing `MainResource` or
`NetworkRecords` cannot load under Jest (`import.meta`). So each audit's scoring, rows and
`Audit.Product` are built by a **pure function in `src/lib/transport-security.js`** (unit-tested with
static fixtures), and the audit files are thin: `meta`, resolve inputs through
`transport-security-sources.js`, call the pure function. The thin files are loaded for real by the
config-resolution test (task-08, real Node ESM) and exercised by live `lhci collect`/`lhci assert` in QA.

One small addition to the contract (additive, flagged for Gate 2): `transport-security-sources.js` exports
three functions, not one: `resolveMainDocumentSecurity` as written, plus `resolveInsecureRecords` (the
`http:` network records, which need `NetworkRecords`) and a pure `findSecurityDetails(log, requestId)`
(the raw-log scan) that lives in `transport-security.js` so it is unit-tested.

## Tasks

### task-01: Mixed-content classification

- scope_whitelist: [packages/seo-audits/src/lib/transport-security.js, packages/seo-audits/test/lib/transport-security.test.js]
- depends_on: none
- description: New pure module with the file-level typedefs from the contract (`MixedContentItem`,
  `MixedContentResult`, `HstsFinding`, `HstsResult`, `CertificateResult`) and the constants
  (`HSTS_MIN_MAX_AGE`, `CERT_WARN_DAYS`, `MAX_ROWS`). Adds `classifyMixedContent({issues, records,
  pageUrl})` (null when the page is not https; merges issues and `http:` records by URL, issues win;
  active/passive table from the audit spec, unknown types active; resolution mapping; active first, then
  by URL) and `mixedContentProduct(result)` (score 0 only when `failing > 0`; `displayValue`; table rows
  with `impact` sentences; 50-row cap with a "N more not shown" row; `notApplicable` when null). Tests:
  every type in both tables, unknown type, blocked passive fails, upgraded passive is a note, allowed
  record with no issue, same URL in both sources, non-https page, no insecure items, ordering, row cap,
  data URIs not counted.
- commit_message: "feat(seo-audits): add mixed-content classification"

### task-02: HSTS evaluation

- scope_whitelist: [packages/seo-audits/src/lib/transport-security.js, packages/seo-audits/test/lib/transport-security.test.js]
- depends_on: task-01
- description: Add `evaluateHsts(headerValues)` and `hstsProduct(result, {isHttps})` per the audit spec:
  first header only (extras are a note), case-insensitive directives, quoted and unquoted `max-age`,
  problems for absent / missing or malformed `max-age` / `max-age=0` / under 31 536 000 / `preload`
  without `includeSubDomains` or without a one-year `max-age`; notes for missing `includeSubDomains`,
  missing `preload`, duplicate header. Tests: each problem and each note, `max-age=31536000` exact
  boundary and one below, `"31536000"` quoted, unknown directives ignored, trailing semicolons and extra
  whitespace, duplicate header, empty string value, non-https page not applicable.
- commit_message: "feat(seo-audits): add HSTS header evaluation"

### task-03: Certificate expiry evaluation

- scope_whitelist: [packages/seo-audits/src/lib/transport-security.js, packages/seo-audits/test/lib/transport-security.test.js]
- depends_on: task-02
- description: Add `findSecurityDetails(log, requestId)` (scans a raw devtools log for the matching
  `Network.responseReceived`, tolerating malformed entries), `evaluateCertificate(securityDetails,
  nowSeconds)` and `certificateProduct(result)` per the audit spec: expired or not-yet-valid score 0,
  15 days or fewer score 0.5 with a `warnings` entry, otherwise 1, `daysRemaining` by floor, null when
  dates are missing or not finite (not applicable with an explanation). Tests: expired, expires today,
  exactly 15 days, 16 days, long validity, not yet valid, missing/NaN dates, `validTo` as a numeric
  string, log with no matching request, log with several responses, log entries of other methods.
- commit_message: "feat(seo-audits): add certificate expiry evaluation"

### task-04: Resolve inputs from the devtools log

- scope_whitelist: [packages/seo-audits/src/lib/transport-security-sources.js]
- depends_on: task-03
- description: New file (imports `MainResource` and `NetworkRecords`, so not Jest-loadable, same as
  `robots-sources.js`, whose header comment it copies the reason from). `resolveMainDocumentSecurity`
  returns the final URL, every `Strict-Transport-Security` value in order, and `securityDetails` via
  `findSecurityDetails` on the main resource's `requestId`; `resolveInsecureRecords` returns the
  `http:` records (`url`, `resourceType`). No tests of its own: covered by task-08's real-Node import
  and by live QA.
- commit_message: "feat(seo-audits): resolve transport-security inputs from the devtools log"

### task-05: mixed-content audit

- scope_whitelist: [packages/seo-audits/src/audits/mixed-content.js]
- depends_on: task-04
- description: Thin audit: `meta` (id `mixed-content`, `requiredArtifacts: ['DevtoolsLog',
  'InspectorIssues', 'URL']`, `supportedModes: ['navigation']`, plain-string title/failureTitle/
  description that state the active/passive rule and the "found during this load" limit), resolves
  inputs, returns `mixedContentProduct(classifyMixedContent(...))`.
- commit_message: "feat(seo-audits): add mixed-content audit"

### task-06: hsts-quality audit

- scope_whitelist: [packages/seo-audits/src/audits/hsts-quality.js]
- depends_on: task-04
- description: Thin audit: id `hsts-quality`, `requiredArtifacts: ['DevtoolsLog', 'URL']`, navigation
  only; description states the thresholds and the limits (honoured only over HTTPS after a first visit;
  no preload-list or subdomain check; not a replacement for core's informative `has-hsts`).
- commit_message: "feat(seo-audits): add hsts-quality audit"

### task-07: ssl-certificate-expiry audit

- scope_whitelist: [packages/seo-audits/src/audits/ssl-certificate-expiry.js]
- depends_on: task-04
- description: Thin audit: id `ssl-certificate-expiry`, `requiredArtifacts: ['DevtoolsLog', 'URL',
  'GatherContext']` only if needed for `fetchTime` (use `artifacts.fetchTime`; confirm the field exists
  on the artifacts object before relying on it, else fall back to `Date.now()` and say so in a comment);
  description states the 15-day band, the 0 / 0.5 / 1 meaning, and that an already-expired certificate
  usually aborts the run before this audit is reached.
- commit_message: "feat(seo-audits): add ssl-certificate-expiry audit"

### task-08: Register the audits

- scope_whitelist: [packages/seo-audits/src/lighthouse-config.js, packages/seo-audits/test/lighthouse-config.test.js]
- depends_on: task-05, task-06, task-07
- description: Add the three paths to `audits` and three `seo-extended` refs (weight 1); update the
  header comment; update the test to thirty-four audits and add the three ids to both lists. The test
  resolves the config in real Node ESM, so it is also the check that the three audit files and the
  sources module load and expose valid `meta`.
- commit_message: "feat(seo-audits): register the transport-security audits"

### task-09: README

- scope_whitelist: [packages/seo-audits/README.md]
- depends_on: task-08
- description: Document the three audits: what each checks, the active/passive rule, HSTS thresholds,
  certificate bands and the 0 / 0.5 / 1 score, the "expired usually aborts the run" limit, the
  `assertMatrix` recipe (verified in live QA before the README states it as working), suggested
  severities, and what each adds over core's `is-on-https` / `has-hsts`.
- commit_message: "docs(seo-audits): document the transport-security audits"
