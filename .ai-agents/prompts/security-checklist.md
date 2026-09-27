# Security checklist

Read by Agent 07. This repo's actual attack surface, not a generic OWASP list — Lighthouse fetches
and executes content from arbitrary, attacker-influenced URLs, and any audit that follows links or
resolves additional resources inherits that risk.

## SSRF prevention

- Any audit/gatherer that fetches a URL discovered on the page (not the page itself, which the
  Lighthouse runner already handles) must validate the target before fetching:
  - Block private/reserved IP ranges (RFC 1918, loopback, link-local) after DNS resolution — not just
    string-matching the hostname, since a hostname can resolve to a private IP.
  - Block the cloud metadata address (`169.254.169.254`) explicitly.
  - Allow only `http`/`https` schemes — reject `file://`, `ftp://`, etc.
- Bound the number of URLs followed and set a timeout per fetch — an audit that recursively follows
  links without a cap turns a single malicious page into resource exhaustion for whoever runs the
  audit.

## Crawler / resource abuse

- Any new gatherer that does extra network activity beyond the single page load should have an
  explicit, documented upper bound (max requests, max total bytes, max time) — not an unbounded loop.

## Chromium / Puppeteer sandbox

- Never introduce `--no-sandbox`, `--disable-web-security`, or similar flag weakening as a side
  effect of a new gatherer needing "just one more permission" — if a gatherer genuinely needs
  elevated CDP access, that's a design decision for Gate 1, not something to slip in during
  implementation.

## Data exposure

- Don't include full page content, cookies, or auth headers in `details`/`debugdata` unless the
  feature spec explicitly requires it for the report — LHR reports can end up stored on
  `packages/server` or shared externally; treat anything written into them as potentially disclosed.
