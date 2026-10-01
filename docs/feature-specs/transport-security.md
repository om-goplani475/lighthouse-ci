# Feature: Transport Security (mixed content, HSTS, certificate expiry)

- slug: transport-security
- requested: 2026-10-01
- type: new-audit

## Summary

Three new audits for the `seo-extended` category, built as one group because they share one data source,
the `DevtoolsLog` Lighthouse already records, so no new gatherer and no request to the audited site:

1. **`mixed-content`** — an HTTPS page that loads resources over plain `http://`. Beyond core's
   `is-on-https` (which lists insecure requests and whether the browser blocked them), this one
   classifies each by what it is: **active** content (scripts, stylesheets, iframes, fetch/XHR, which
   browsers block and which break the page) versus **passive** content (images, audio, video, which
   browsers may upgrade or load with a warning), and says in plain English what each means for the page.
2. **`hsts-quality`** — whether the main document sends `Strict-Transport-Security`, and whether it is
   good enough to rely on: `max-age` of at least one year, `includeSubDomains`, and `preload` only if
   its prerequisites hold. Core's `has-hsts` is informative with weight 0 and fails nothing; this gives a
   pass/fail against stated thresholds.
3. **`ssl-certificate-expiry`** — the days until the main document's TLS certificate expires, read from
   `securityDetails.validFrom/validTo` on the raw `Network.responseReceived` event. Core does not report
   certificate expiry at all. Fails when expired or expiring inside a threshold; a warning band before
   that.

Decisions made with the developer (Phase 5 planning, 2026-10-01): build fork versions of mixed content
and HSTS even though core overlaps; no outbound requests for this group.

## Concrete pass/fail example

- **mixed-content, pass**: an HTTPS page whose every request is HTTPS. **Fail**: an HTTPS page with a
  `<script src="http://cdn.example.com/lib.js">` (active, "blocked by browsers, the feature using it is
  broken") or an `<img src="http://example.com/logo.png">` (passive, a lesser finding). A plain-HTTP
  page is not applicable: the finding there is "the page is not HTTPS" (core's `is-on-https`).
- **hsts-quality, pass**: `Strict-Transport-Security: max-age=31536000; includeSubDomains`. **Fail**: no
  header, `max-age=300`, or `max-age=0`. A `preload` directive without `includeSubDomains` or without
  `max-age` of at least one year is a finding too (the preload list would reject it).
- **ssl-certificate-expiry, pass**: a certificate valid for 60 more days. **Fail**: expired, or
  expiring within 14 days. **Warn**: 15 to 30 days. A plain-HTTP page, or a request with no
  `securityDetails`, is not applicable.

## Gatherer needs

- New gatherer required: no.
- Existing data: the `DevtoolsLog` artifact (raw protocol events, including `Network.responseReceived`
  with `response.securityDetails`, and the main document's response headers), plus `URL`.

## Scope

- Package(s) affected: packages/seo-audits only.
- Out of scope: any outbound request (the host-variant and soft-404 probes are items 4 and 5); the
  certificate's chain, issuer trust or hostname match (the browser already refuses a bad chain and the
  run would not complete); HSTS on subdomains other than the audited host; checking the HSTS preload
  list over the network; mixed content found only by inspecting HTML rather than requests actually made.
- Does not change core's `is-on-https` or `has-hsts`; both stay in the report.

## Open questions

For Agent 01/02 to settle in design (none blocks the spec):

- Does the raw `DevtoolsLog` reliably carry `securityDetails` on the main document's response in
  navigation mode (verify against a real HTTPS run before the contract is written)? If not, the
  certificate audit has no data source without a request and gets re-scoped.
- Exact thresholds (HSTS one year; certificate 14 and 30 days) and suggested assertion severities.
- Requests Lighthouse itself blocks or upgrades before they appear in the log, which would make
  `mixed-content` under-report; document the limit if so.
