# QA checklist: Transport Security

- slug: transport-security
- merged: fcf095b (into `phase-5-crawlability`, ff-only; `base_commit` e8ea6a5)

Covers `mixed-content`, `hsts-quality` and `ssl-certificate-expiry`. Verified with real Lighthouse and
`lhci collect` / `lhci assert` runs against a local HTTPS fixture site (self-signed certificates with
chosen lifetimes; fake hostnames mapped to loopback with `--host-resolver-rules` so Chrome treats
`http://` resources as genuinely insecure, since `localhost` itself is exempt from mixed-content rules)
and two public sites (`example.com`, `github.com`), not only unit tests. The fixture needs
`--ignore-certificate-errors`, which is a QA-only flag.

## Functional

- [x] **`mixed-content`, active fail** (`<script>` and `<link rel=stylesheet>` over `http://`): score 0,
      "2 active or blocked insecure resource(s) found during this load". Both rows `Active` / `Blocked`
      with "Blocked by the browser: this resource did not load, so whatever depends on it is broken."
      Core's `is-on-https` also fails (2 insecure requests), as expected.
- [x] **`mixed-content`, passive pass** (two `<img src="http://...">`): score 1, "2 insecure resources",
      rows `Passive` / `Auto-upgraded` ("Chrome upgraded it to https:// for this load, but the source
      still says http://"). **This is the designed difference from core**: `is-on-https` scores the
      same page 0.
- [x] **`mixed-content`, clean page** and the two public sites: score 1, no rows.
- [x] **`hsts-quality`**: `max-age=31536000; includeSubDomains` passes; no header fails ("No
      Strict-Transport-Security header ..."); `max-age=300` fails ("0 day(s); use at least 31536000");
      `max-age=0` fails ("turns HSTS off"); `max-age=31536000; preload` fails ("preload is set without
      includeSubDomains"); two headers (`max-age=31536000` then `max-age=0`) passes on the first and shows
      the note "2 headers sent; browsers use only the first". `github.com` (real, `max-age=31536000`)
      passes; `example.com` (none) fails. Core's `has-hsts` scores 1 informatively on every one of these,
      which is why the fork audit exists.
- [x] **`ssl-certificate-expiry`**: 399 days left scores 1; 9 and 14 days left score **0.5** with the
      run warning "The certificate for secure.test expires on 2026-10-11 (9 day(s) from now); renew it
      before then."; an expired certificate scores 0 ("expired on 2026-09-28"); a not-yet-valid one scores
      0 ("not valid until 2026-10-04"). Real sites: `example.com` 85 days, `github.com` 59 days.

## Edge cases

- [x] **Plain `http://` page**: all three audits `notApplicable` (no crash, no score).
- [x] **Missing certificate details**: unit-tested (`evaluateCertificate`/`certificateProduct` return
      not-applicable with an explanation); not reproducible live.
- [x] **Expired certificate without `--ignore-certificate-errors`**: Lighthouse aborts with
      `INSECURE_DOCUMENT_REQUEST` and no audit results are produced. Confirmed with an untrusted
      self-signed certificate; an expired certificate from a trusted CA reaches the same interstitial but
      was not tested. This is the documented limit: the score-0 states are reachable only when certificate
      errors are ignored, so the 15-day warning band is the audit's real value.
- [x] Duplicate headers, quoted/odd-case directives, boundary values (exactly one year, 15 vs 16 days,
      a request id repeated through a redirect), row cap, unknown resource types: unit (61 tests in
      `test/lib/transport-security.test.js`).
- [ ] **Not observed live**: an active resource that Chrome *allowed* (it blocked every active type on
      the fixture), and a passive resource with the warning resolution (Chrome upgraded them all). Both
      paths are unit-tested only.

## Integration

- [x] **Category**: with `--only-categories=seo-extended` the category holds 34 audits; the three new ones
      are present at weight 1 and contribute their real scores (1 / 0 / 0.5) to the category total.
- [x] **Report rendering** (Lighthouse's own HTML report, generated from the LHR): HSTS shows as a red
      failure with the explanation inline; the certificate audit shows amber with "9 days remaining" and
      a "Warnings:" box, under the title "TLS certificate is expired, not yet valid, or about to expire".
- [ ] **`packages/viewer`** was **not** checked.
- [x] **Config keys**: none added. `configPath` alone picks the three audits up; no environment variable.
- [x] **`lhci assert`, real run** with an `assertMatrix` of two entries (error at `minScore: 0.5`, warn at
      `minScore: 1`) on `ssl-certificate-expiry`: 9 days left prints a warning and exits 0; score 0 prints
      an error and exits 1; score 1 is clean. Separately, `hsts-quality` as `error` on a page with no
      HSTS prints "failure for minScore assertion" and exits 1.

## Regression

- [x] Core audit scores unchanged by registering the fork config: on the same page, `seo` (0.9) and
      `best-practices` (0.89) category scores and all 32 audit scores are identical with and without the
      fork config (0 differences).
- [ ] `npm run start:seed-database` was **not** run.
- [x] Full `npm run test`: the same 12 failing suites outside seo-audits as on the base commit (compared
      in `.ai-agents/state/ci-backlog.md`); every seo-audits suite passes.

## Findings

- None against the audits. One wording defect was found during implementation (the failure title said
  "expired or not yet valid" while the 0.5 band shows as failed) and fixed in `fcf095b`.
- Observation, not a defect: on a `localhost` fixture the report also carries the Phase 4 run warnings
  that the sitemap audits and `llms.txt` were skipped (private-network policy); unrelated to this feature.
