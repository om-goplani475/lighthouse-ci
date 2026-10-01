# Feature contract: Transport Security

- slug: transport-security

## TypeScript types

Plain ESM JS with JSDoc typedefs (see `lighthouse-conventions.md`), field-for-field the audit spec's
shapes. All in `packages/seo-audits/src/lib/transport-security.js` (pure, Jest-loadable).

```js
/**
 * @typedef {'active' | 'passive'} MixedKind
 * @typedef {'blocked' | 'auto-upgraded' | 'allowed'} MixedResolution
 * @typedef {{
 *   url: string,
 *   type: string,                 // CDP MixedContentResourceType, or the record's resourceType, or 'Unknown'
 *   kind: MixedKind,
 *   resolution: MixedResolution,
 * }} MixedContentItem
 *
 * @typedef {{
 *   items: MixedContentItem[],    // de-duplicated by URL, active first
 *   failing: number,              // active or blocked
 *   notes: number,                // passive and not blocked
 * }} MixedContentResult
 *
 * @typedef {{directive: string, value: string | null, finding: string, severity: 'problem' | 'note'}} HstsFinding
 * @typedef {{
 *   present: boolean,
 *   headerCount: number,
 *   maxAge: number | null,
 *   includeSubDomains: boolean,
 *   preload: boolean,
 *   findings: HstsFinding[],
 *   passes: boolean,              // no finding with severity 'problem'
 * }} HstsResult
 *
 * @typedef {{
 *   subject: string | null,
 *   issuer: string | null,
 *   validFrom: number,            // Unix seconds, as in CDP
 *   validTo: number,
 *   daysRemaining: number,        // floor((validTo - nowSeconds) / 86400); negative when expired
 *   state: 'expired' | 'not-yet-valid' | 'expiring-soon' | 'ok',
 * }} CertificateResult
 */

// Pure functions (no I/O, no import.meta):
//   classifyMixedContent({issues, records, pageUrl}) -> MixedContentResult | null   (null: page not https)
//   evaluateHsts(headerValues: string[]) -> HstsResult
//   evaluateCertificate(securityDetails, nowSeconds) -> CertificateResult | null   (null: no usable dates)
//   CONSTANTS: HSTS_MIN_MAX_AGE = 31_536_000, CERT_WARN_DAYS = 15, MAX_ROWS = 50
```

```js
// packages/seo-audits/src/lib/transport-security-sources.js: imports MainResource, NOT Jest-loadable
// (same reason as robots-sources.js).
/**
 * @param {{DevtoolsLog: unknown, URL: unknown}} artifacts
 * @param {import('lighthouse/types/audit.js').default.Context} context
 * @return {Promise<{
 *   finalUrl: string,
 *   hstsHeaderValues: string[],           // every Strict-Transport-Security value, in order
 *   securityDetails: object | null,       // raw CDP SecurityDetails of the main document response
 * }>}
 */
// async function resolveMainDocumentSecurity(artifacts, context)
```

Audit result shapes (Lighthouse `Audit.Product`):

| Audit | score | displayValue | details | warnings |
|---|---|---|---|---|
| `mixed-content` | 0 if `failing > 0`, else 1 | "N insecure resource(s)" when any | table: `url`, `type`, `kind`, `resolution`, `impact` | none |
| `hsts-quality` | 0 if not `passes`, else 1 | none | table: `directive`, `value`, `finding` | none |
| `ssl-certificate-expiry` | 0 expired / not yet valid, 0.5 at 15 days or fewer, else 1 | "N days remaining" | table: `subject`, `issuer`, `validFrom`, `validTo`, `daysRemaining` | one message at 0.5 |

Not applicable (`notApplicable: true`): final URL not `https:` (all three); no `securityDetails`
(certificate audit only; the reason goes in `explanation`).

## `.lighthouserc.js` config additions

**None.** `configPath` only, same as every prior audit. No environment variable and no config key: the
thresholds (one-year HSTS, 15-day certificate band, 50 rows) are constants, because nothing here sends a
request and a knob that moves a verdict would make results incomparable between teams. A fresh install
needs no new configuration.

## Assertion presets

| Preset | Severity |
|--------|----------|
| lighthouse:recommended | n/a, not added to shared presets |
| lighthouse:all | n/a, not added to shared presets |
| (fork preset) | n/a, none exists; README guidance below |

Not added to `recommended.js`/`all.js` (opt-in via `configPath`; `packages/utils/test/presets.test.js`
would fail otherwise), like every prior audit. Suggested severities, deliberately different, stated in
the README (documentation only, not enforced):

| Audit | Suggested | Why |
|---|---|---|
| `mixed-content` | `error` (`minScore: 1`) | Fails only on blocked or active content: Chrome itself reports it, it breaks the page, and there is no legitimate reason to ship it. Low false-positive risk. |
| `hsts-quality` | `warn` (`minScore: 1`) | Staging and internal hosts legitimately omit or shorten HSTS, and a CDN may set it at the edge only on production. Move to `error` for production-only jobs. |
| `ssl-certificate-expiry` | `error` at `minScore: 0.5`, and `warn` at `minScore: 1` | `0.5` means "15 days or fewer left" and `0` is expired. An `assertions` map holds one entry per audit id, so "fail on expiry, notify at 15 days" needs an `assertMatrix` with two entries on the same URL pattern (`docs/configuration.md`): one `['error', {minScore: 0.5}]`, one `['warn', {minScore: 1}]`. A single `warn` at `minScore: 1` is the simple alternative. |

Examples: `'mixed-content': ['error', {minScore: 1}]`, `'hsts-quality': ['warn', {minScore: 1}]`.

## Public exports

New/modified files, all within `packages/seo-audits`:
- `src/lib/transport-security.js`: new (pure logic and typedefs)
- `src/lib/transport-security-sources.js`: new (resolves headers and `securityDetails`; not unit-tested
  directly, covered by the live QA run, like `robots-sources.js`)
- `src/audits/mixed-content.js`, `src/audits/hsts-quality.js`, `src/audits/ssl-certificate-expiry.js`: new
- `src/lighthouse-config.js`: three audit paths and three `seo-extended` refs (weight 1); no `artifacts` entry
- `test/lib/transport-security.test.js`, `test/audits/{mixed-content,hsts-quality,ssl-certificate-expiry}.test.js`,
  `test/lighthouse-config.test.js` (thirty-one to thirty-four)
- `README.md`: the three audits, limits, severities
- no `package.json` change (no new dependency)

`packages/cli` never imports `@lhci/seo-audits` directly (unchanged pattern).

## Consistency check

Cross-checked against `docs/audit-specs/transport-security.md` (completed, not provisional): typedef
fields, the `kind`/`resolution` vocabularies, the thresholds (31 536 000 s, 15 days, 50 rows), the scores
(0 / 0.5 / 1 for the certificate; binary for the other two) and the not-applicable rules match. One
point to confirm at Gate 1: the two-assertion recipe for the certificate audit uses `assertMatrix`
(read in `docs/configuration.md` and `packages/utils/src/assertions.js`: one level per assertion key, so a
plain map cannot hold two). Live QA will run that recipe through a real `lhci assert` rather than assume it.
