# Security findings

## 2026-09-29 — favicon-and-manifest (manifest-icons, src/lib/safe-fetch.js)

**The one genuinely new attack surface introduced in Phase 1**: `manifest-icons` is the first
audit in this package to fetch a second URL discovered on the page (the web app manifest's
`href`), rather than only reading data Lighthouse's own page load already collected. Reviewed
against `.ai-agents/prompts/security-checklist.md`'s SSRF section in full, which exists
specifically for this scenario.

- severity: n/a — this is a review of a feature built *with* the checklist's protections from the
  start (confirmed via blocking question before implementation that this needed real SSRF care,
  not a quick fetch), not a finding against already-shipped code.
- **Scheme allowlist**: only `http:`/`https:` accepted, checked before any connection attempt
  (`safeFetchJson`). Verified via unit test (`file:///etc/passwd` rejected).
- **Private/reserved IP blocking, after DNS resolution, not hostname string matching**: covers
  RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback, link-local (which covers
  the `169.254.169.254` cloud metadata address specifically, and is also checked as its own case),
  carrier-grade NAT, and the IPv6 equivalents (`::1`, `fe80::/10`, `fc00::/7`,
  IPv4-mapped-in-IPv6). Verified via 16 unit tests directly exercising `isPrivateOrReservedIp` and
  `safeLookup` against each range, plus two live-collect runs (see docs/qa/favicon-and-manifest.md)
  confirming the block fires against a real fetch attempt, not just in isolation.
- **DNS-rebinding resistance**: the IP address `safeLookup` validates is the exact one Node's
  `http`/`https` client connects to (via the `lookup` request option), not re-resolved by a
  separate step — closing the classic TOCTOU gap where a hostname could resolve to a safe IP
  during validation and a private one at actual connection time.
- **A real bug caught during development, not shipped**: Node's `http`/`https` client silently
  skips the custom `lookup` option entirely when the URL's hostname is already a literal IP
  address (confirmed empirically — a request to a literal `http://127.0.0.1:1/x` URL reached
  `ECONNREFUSED` instead of being blocked, proving `safeLookup` never ran). This is the simplest
  possible bypass of the whole protection (just put the raw IP in the URL instead of a hostname
  that resolves to it) and was caught by the test suite itself
  (`test/lib/safe-fetch.test.js`'s "refuses to fetch a loopback URL" case failing) before this was
  ever wired into an audit. Fixed with an explicit pre-check for literal-IP hostnames in
  `safeFetchJson`, independent of `safeLookup`. Recorded here because it's exactly the kind of
  mistake this checklist exists to catch, and it *was* caught — by a test written specifically to
  prove the protection works end-to-end, not just documented as should-work.
- **No redirect following**: a redirect response is not followed (only a direct 2xx is accepted);
  following redirects would reopen the origin-validation gap (validate a safe URL, get redirected
  to a private one).
- **Bounded**: single request, default 5s timeout, default 1MB response-size cap, both
  configurable per-call (not exposed to the page/attacker).
- **A related, pre-existing exposure this feature does *not* introduce, worth recording so it's
  not mistaken for a gap in this feature's own protection**: during live verification, pointing a
  test page's manifest link at the real `169.254.169.254` cloud-metadata address caused the
  *entire Lighthouse collection* for that page to stall for roughly 90 seconds in this sandboxed
  environment, before `manifest-icons`' own (correctly SSRF-protected) fetch code ever ran. This
  points to headless Chrome itself attempting to fetch a page's declared manifest during normal
  navigation (for its own installability-eligibility signals), independent of anything this
  package does. That behavior is core Lighthouse/Chrome, predates this feature, and affects any
  Lighthouse run against any page with a manifest link pointing somewhere slow/unreachable — not
  something `manifest-icons` introduced or can fix from an audit-level check (audits run *after*
  collection completes). Live verification was redone against a closed local port instead (fails
  fast via instant connection-refused) to avoid repeatedly triggering this unrelated, slow
  pre-existing behavior. Not filed as a severity-rated finding since it's out of this package's
  control surface, but recorded so a future reader doesn't mistake the multi-minute hang for a bug
  in this feature specifically if they encounter it again.
- **Data exposure**: the audit's `explanation` string on failure includes the fetch-error message
  (e.g. "refusing to fetch ... a private/reserved IP address"). This could theoretically inform an
  attacker running their own audit against their own page that an internal-IP manifest link was
  blocked — but they already control the page and chose that URL themselves, so this discloses
  nothing they don't already know. No sensitive data (cookies, headers, response bodies from
  blocked targets) is ever included; a blocked fetch never receives a response body at all.

No `critical`/`high` findings. Nothing blocks the next feature — but any *future* audit/gatherer
that needs to fetch a page-discovered URL should reuse `safe-fetch.js` rather than reimplementing
this from scratch, given how easy the literal-IP bypass was to miss.

## 2026-09-29 — pixel-width-truncation

**No findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`. Merged diff range
`1729f7c..5fea5d1` on `phase-1-page-metadata` (merged locally, no PR — see
`.ai-agents/state/current-feature.md`). `git diff --name-only` scoped to `*.js` files, grepped for
`fetch\(|http\.|https\.|child_process|exec\(|eval\(|--no-sandbox|--disable-web-security|appendChild`
— the only matches are `child_process.exec`/`execFile` in four **test** files, the same
already-reviewed shell-out-to-real-node pattern every audit test in this package uses to work around
Jest's inability to load a module using `import.meta.url` (see `structured-data-validation`'s and
`structured-data-rule-engine`'s prior reviews of this exact pattern) — hardcoded local script
content and hardcoded local file paths only, never attacker/page-influenced input.

- **SSRF / network fetch**: not applicable — the new `PixelWidth` gatherer makes zero network
  requests. It reads `document.title` and the existing `<meta name="description">` element's
  `content` attribute, both already present in the DOM from the page load Lighthouse's own runner
  performs — no URL is fetched, discovered, or followed by this feature at all.
- **Crawler / resource abuse**: not applicable — same reasoning; no additional network activity
  beyond the single page load every gatherer already gets for free.
- **Chromium / Puppeteer sandbox**: no new CDP session, no new Chromium flags. The gatherer reuses
  `driver.executionContext.evaluate(fn, {args, useIsolation: true, deps: []})` — the exact same
  mechanism `structured-data-json-ld`'s gatherer already uses (reviewed and accepted in
  `structured-data-validation`'s security review) — with `useIsolation: true`, i.e. the evaluated
  function runs in a CDP isolated world, not the page's own JS realm.
- **Canvas isolation / page-observability, reviewed beyond the checklist's literal items**: the
  off-screen `<canvas>` element the evaluated function creates via `document.createElement('canvas')`
  is **never appended to the live DOM** (confirmed by reading `gatherers/pixel-width.js`'s
  `collectPixelWidth` — no `appendChild`/`insertBefore` call anywhere) and the measurement itself
  runs in an isolated world. Two independent reasons the page's own scripts (including any
  canvas-fingerprinting-detection code a malicious/adversarial test page might run) cannot observe
  this gatherer's canvas use at all.
- **Data exposure**: the audit's report rows include the measured `text` (the page's own `<title>`
  content and meta description content) — the exact same values Lighthouse core's own
  `document-title` and `meta-description` audits already surface in every standard LHR report. No
  new data (cookies, headers, unrelated page content) is captured; `rulesetVersions` stamps only an
  internal version string (`"2026-10"`), never page-derived data.
- **Rule-derived input, reviewed as a genuine architectural first**: this is the first gatherer in
  the package to import from `rule-engine/registry.js`. The two font strings it passes as `args`
  into the evaluated page function (`ctx.font = font`) come exclusively from this fork's own
  checked-in, schema-validated `rules/serp-pixel-budgets/*.json` — never from page content or any
  other attacker-influenced source — so there is no injection surface through the font value, and
  `registry.js`'s existing file-read/schema-validation path (already reviewed in
  `structured-data-rule-engine`) is unchanged by this addition beyond one new additive
  `resolveSerpPixelBudgetsRuleset()` export.
- **Minor, non-blocking observation**: `ctx.measureText(text)` is called on `document.title`/the
  meta description's raw content with no length cap — a pathological page with an extremely long
  title or description string could make this measurement call slower. Not a new risk: Lighthouse
  core's own `document-title`/`meta-description` audits already read these same fields with no
  length cap, and canvas text measurement is a bounded, non-recursive browser API call (no
  unbounded loop, no network I/O) — the cost scales with input size but cannot hang or amplify into
  something larger than the string itself. Recorded for completeness per the checklist's
  data-exposure/resource-use criteria, not because it changes this feature's risk profile from any
  existing audit in the package.

No `critical`/`high`/`medium`/`low` findings requiring action. Nothing blocks the next feature.

## 2026-09-29 — structured-data-type-conflicts

- severity: low
- finding: `structured-data-type-conflicts.js`'s `audit()` originally built `typeCounts` and
  `blocksByType` as plain `{}` object literals keyed directly by the page's own JSON-LD `@type`
  value — fully page/attacker-controlled. A block declaring `"@type": "__proto__"` against a plain
  object literal triggers the inherited `__proto__` accessor, silently reassigning that specific
  object's own prototype instead of creating a normal data property. Confirmed via direct Node
  test: does **not** pollute the global `Object.prototype` (other objects/audits are unaffected —
  the effect is contained to that one local object), but it is undefined-ish, unintended behavior a
  page shouldn't be able to trigger at all.
- status: **resolved**, fixed in the same sitting rather than deferred to backlog (cheap fix, real
  code I'd just written) — both objects now use `Object.create(null)`, which has no `__proto__`
  setter, so every `@type` string behaves as an ordinary data key. Verified live: a page with
  `"@type": "__proto__"` now audits cleanly (score 1, no findings — the type simply isn't tracked,
  same as any other unrecognized type). Added a regression test
  (`structured-data-type-conflicts.test.js`) asserting this specific case, not just reasoning about
  it.
- other checklist items reviewed, no findings:
  - SSRF / network fetch: not applicable — no network code anywhere in the diff (confirmed via
    grep for `fetch|http\.|https\.|child_process|exec\(|eval\(` across the new audit, engine, and
    registry addition — zero matches).
  - New dependency: **none** — `package.json` untouched.
  - `registry.js`'s modification (adding `resolveTypeConflictsRuleset()`) is additive-only, reviewed
    against the three already-shipped `resolve*Ruleset` functions — no shared-code risk introduced.
  - Report data exposure (worth noting, not fixing): `conflicting-entity` findings embed the full,
    unbounded field *values* that differ (e.g. both prices in a price conflict) into the report
    message — broader than `structured-data-json-ld`'s existing 80-char-capped snippet. Assessed as
    low risk under the same "JSON-LD is public, crawler-facing markup the site owner already
    published" reasoning accepted for that snippet, but unlike the snippet this has no length cap —
    a pathological page with a very large field value could produce an unusually large report
    entry. Not fixed now (truncating could remove the exact information a developer needs to
    resolve the conflict), but worth a length cap if this proves to matter in practice — recorded
    for a future revision, not blocking.

## 2026-09-29 — structured-data-rich-result-eligibility

**No findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`. This feature's entire
diff (`14fb4b0..62d659c`) is a new audit file, its fixture test, a config-registration change, and
README/state docs — confirmed via `git diff --name-only`, zero matches for
`fetch|http\.|https\.|child_process|exec\(|eval\(` in the new audit source.

- SSRF / network fetch: not applicable — no network access, no file I/O beyond what
  `resolveEligibilityRuleset()` already does (reviewed and accepted in the `structured-data-rule-engine`
  review). This feature adds no new file-reading logic of its own.
- New dependency: **none** — `packages/seo-audits/package.json` has no diff in this feature.
- Report data exposure: the `type` column can now contain **any** `@type` string found on the page,
  including untracked ones — this is a deliberate behavioral difference from
  `structured-data-schema-properties` (which only echoes a fixed allowlist of 12 known type names)
  and is worth flagging explicitly rather than waving through by precedent. Assessed as low risk:
  `@type` values are, by definition, values a site owner already chose to publish in public,
  crawler-facing JSON-LD markup — the same category of already-public data
  `structured-data-json-ld`'s snippet field was reviewed and accepted for. An arbitrary string here
  is bounded (comes from a JSON string value, rendered as a plain-text table cell, not interpreted
  as markup/HTML) and Lighthouse's own report renderer already treats table `text` cells as
  plain text, not raw HTML — no new XSS/injection surface introduced by widening from 12 fixed
  values to arbitrary page-supplied strings.
- Prototype pollution / DoS: grouping uses a plain `Map` keyed by the `@type` string (not a plain
  object), so a page supplying `@type: "__proto__"` cannot pollute `Object.prototype` — confirmed by
  reading the implementation, not assumed. Unbounded-growth risk (an attacker page with many
  thousands of distinct `@type` strings inflating the report table) is the same bound every other
  audit consuming this gatherer's artifact already accepts (bounded by whatever
  `StructuredDataJsonLd` collects, no new gatherer here).

## 2026-09-28 — structured-data-remaining-types

**No findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`. This feature's entire
diff (`f97606c..00e6f71`) is 9 files: two JSON ruleset files, two `current.json` version pointers, a
README, and three test files — confirmed via `git diff --name-only`, zero matches for
`fetch|http\.|https\.|child_process|exec|eval\(` across the changed non-test files.

- SSRF / network fetch: not applicable — no code changes at all (audit, engines, gatherer, registry
  all untouched by this feature). The same "registry.js only reads local files, never attacker
  input" reasoning from `structured-data-rule-engine`'s review still holds; this feature adds rows to
  those already-reviewed files, not new file-reading logic.
- New dependency: **none** — `packages/seo-audits/package.json` has no diff in this feature. The
  `ajv` dependency reviewed for the prior feature is unchanged and still only validates this fork's
  own checked-in files.
- Prototype pollution: unchanged from the prior review — no merge/assign operation was introduced;
  this feature is pure data.
- Report data exposure: the 10 new types extend the same fixed-allowlist mechanism already reviewed
  — `googleRuleset.types[schemaType]` must match one of the 12 tracked types before any row is
  generated, so an attacker-controlled `@type` value still can't get echoed into the report
  unless it happens to be one of the 12 known type names, same guarantee as before. Property/message
  text for the 10 new types is this fork's own authored ruleset content (Google's published
  guidelines as documented in `docs/audit-specs/structured-data-remaining-types.md`), not derived
  from page content.
- Restricted-eligibility data (`FAQPage`/`HowTo` → `supported: false`) is informational text only,
  no new surface — reviewed as a correctness/accuracy decision at design time
  (`docs/audit-specs/structured-data-remaining-types.md`), not a security concern.

## 2026-09-28 — structured-data-rule-engine

**No findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`:

- SSRF / network fetch: not applicable — no network access anywhere in the new code (`registry.js`
  only reads local files under `packages/seo-audits/rules/`; confirmed via direct grep for
  fetch/http/exec/eval/child_process — zero matches).
- File paths passed to `registry.js` (`rulesDir`, `schemaPath`) are always hardcoded by the calling
  audit, never derived from page content or any attacker-influenced input — no path-traversal
  surface.
- `ajv` (new dependency, task-01) only validates this fork's own checked-in `rules/*.json` files
  against this fork's own checked-in schemas — never validates or compiles a schema derived from
  page content. Not exposed to attacker input.
- Prototype pollution: `google-requirements-engine.js`/`schema-org-engine.js` only read properties
  off the page-content-derived parsed object (`property in parsedBlock`) — no merge/assign operation
  that could combine an attacker-supplied `__proto__` key with a shared object. Plain `JSON.parse`
  does not itself cause prototype pollution (that risk applies to merge/copy operations, not simple
  property reads).
- Report data exposure: the new audit's `type` column only ever contains `Product`/`Article` (an
  exact match against the fixed tracked-type list is required before a row is generated at all —
  untracked `@type` values are skipped entirely, never echoed into the report). `property`/`message`
  values come from this fork's own ruleset data, not page content. No new echo-page-content-into-report
  surface beyond what was already reviewed and accepted for `structured-data-json-ld`'s snippet field.

## 2026-09-27 — structured-data-validation

- severity: low
- finding: the audit's report table includes an 80-char `snippet` of each
  `<script type="application/ld+json">` block's raw text content
  (`packages/seo-audits/src/audits/structured-data-json-ld.js`'s `snippetOf`). If a page embeds
  something sensitive-looking in a JSON-LD block (e.g. a staging page accidentally including a
  key-shaped string), it would surface in the LHR report, which `packages/server` may store.
- status: resolved — not a regression. Precedent confirmed: Lighthouse's own core `hreflang` audit
  (`node_modules/lighthouse/core/audits/seo/hreflang.js:104`) already echoes raw page markup
  (`<link>` snippets) into report details. JSON-LD blocks are, by design, content site owners
  deliberately embed in publicly-served HTML for search engines to read — not private data, and
  consistent with this repo's existing audit-report conventions. No action needed; recorded for
  completeness per the security-checklist's data-exposure criterion, not because it's a new risk.

**No other findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`:
- SSRF: not applicable — this feature makes no new network fetch of any kind. The gatherer only
  reads `<script>` content already present in the DOM via
  `driver.executionContext.evaluate(...)` (the same CDP-evaluate mechanism the core `MetaElements`
  gatherer uses), never fetches an external URL.
- Crawler/resource abuse: not applicable — no additional network activity beyond the page load
  Lighthouse already performs.
- Chromium/Puppeteer sandbox: no new CDP session or Chromium flags introduced; uses the same
  `driver.executionContext.evaluate` path as an existing core gatherer.

No `critical`/`high` findings. Nothing blocks the next feature.

<!-- Appended by Agent 07 after each /security-review. Format per entry:

## {date} — {slug}

- severity: critical | high | medium | low
- finding: {description}
- status: open | resolved

A `critical` entry with status `open` blocks Agent 00 from starting new work (see
.ai-agents/agents/00-product-intake.md, Step 1).
-->

## 2026-09-30 — sitemap-fetch-and-parse

Reviewed `git diff 299b2ab..5b76bb7` (the gatherer, `safeFetchBytes`, the parser, the three audits)
against the checklist, with each attack case run rather than argued: the real default fetch path
against SSRF payloads, and the parser against hostile documents. Two of the findings below are in
code that predates this feature; both were made reachable from page-controlled input by it.

### Finding 1

- severity: high
- finding: **SSRF bypass: bracketed IPv6 literals skipped the private-address check.**
  `safe-fetch.js` guarded literal IPs with `net.isIP(url.hostname)`, but `new URL()` keeps the
  brackets on an IPv6 host (`[::1]`) and `net.isIP('[::1]')` is `0`. Node also skips the `lookup`
  option for literal IPs, so any IPv6 literal was fetched unvalidated. Reproduced with the real
  `safeFetchBytes`: `http://[::ffff:127.0.0.1]/` and `http://[::ffff:7f00:1]/` were fetched (a local
  listener answered 502), and `[::1]`/`[fd00::1]` reached the connect stage. Independently,
  `isPrivateIPv6` only recognized the dotted `::ffff:1.2.3.4` form, but the URL parser normalizes to
  hex (`[::ffff:169.254.169.254]` becomes `::ffff:a9fe:a9fe`, the cloud metadata address), and it
  missed IPv4-compatible, NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) forms wrapping a private IPv4.
  Exposure: a hostile page's robots.txt `Sitemap:` line (this feature), and equally an `og:image`
  or manifest URL (Phase 1/3, `open-graph-image-reachable`, `manifest-icons`), could make the CLI
  issue a GET to an internal service or metadata endpoint from wherever it runs. Blind (responses
  are not shown), but a GET can have side effects and the status/error text reaches the report.
- status: **resolved and merged** (`ad8557c`, 2026-09-30): the URL's brackets are
  stripped before the check, and `isPrivateIPv6` now works on the address bytes and covers mapped,
  compatible, NAT64, 6to4, multicast, documentation and discard ranges. 31 new regression tests fail
  on the old code and pass on the fix; the payloads above are refused before any connection.

### Finding 2

- severity: high
- finding: **Quadratic-time denial of service in the sitemap parser.** `saxes`' cost per opening
  tag grows with nesting depth, and parsing is synchronous, so no fetch timeout can interrupt it.
  Measured: 96 KB of nested `<a>` took 17 s; a 1 MiB document did not finish in over five minutes.
  A hostile site's sitemap (or a child sitemap listed in its index) could hang the Lighthouse run.
- status: **resolved and merged** (`7ec20c4`, 2026-09-30): `LIMITS.MAX_DEPTH = 32`
  (real sitemaps nest 4-6 deep); exceeding it aborts parsing immediately and is reported as a parse
  error. The 96 KB case now takes 1 ms. Other shapes measured and fine: 1M flat elements (0.2 s), 40k
  attributes on one tag, 4k namespace declarations, a single 20 MiB `<loc>` (0.1 s).

### Finding 3

- severity: low
- finding: no overall deadline for the gatherer. Each request is bounded (10 s total, 5 s for
  robots.txt) and the document count is bounded (10), but sequentially the worst case is about
  105 s of network time, plus a few seconds of synchronous parsing, before a run can finish.
  Bounded and documented, though the checklist prefers an explicit time budget.
- status: **resolved 2026-10-01** by the commit "fix(seo-audits): cap the sitemap gatherer's total time":
  one shared budget of `LIMITS.DOCUMENTS_BUDGET_MS` = 40 s covers robots.txt and every sitemap document
  (each request gets `min(its own limit, time left)`, none is started with under 1 s left, and running out
  sets `documentsTruncated`, which the audits already report). Tradeoff accepted: a very large sitemap on a
  slow server can now be truncated where it used to be read in full. Measured worst case after the fix:
  see Finding 6.

### Finding 4

- severity: low
- finding: pages served from private addresses (an intranet or staging site audited from CI) make
  the sitemap audits silently not-applicable: the SSRF policy correctly refuses the page's own
  robots.txt, but the artifact records only `discovery: 'unavailable'`, not why, so nobody can tell
  a real "unavailable" from "refused by policy". Not a vulnerability; a diagnosability gap.
- status: **resolved 2026-09-30** by the private-network opt-in (`8a4e0f4`) and the run warning that names
  the cause and the setting (`24e1bfd`). Entry kept open until now only because this line was never updated.

### Accepted by design decision, recorded for completeness

- Cross-origin `Sitemap:` URLs are fetched (developer decision, 2026-09-30). A hostile robots.txt can
  make the CLI issue at most 5 declared + 5 child GETs to public hosts of its choosing, on any port.
  Every request has the SSRF, size, time and count bounds above.
- Strings from the fetched site (a redirect's `Location`, an error message naming the URL) are
  placed in report tables. They are limited by Node's header-size cap and rendered as text by
  Lighthouse's report renderer. Response bodies are never stored, and page cookies or auth headers
  are never sent or recorded.

### Checked and found sound

- Literal IPv4 in decimal, hex, octal and short forms (`2130706433`, `0x7f.1`, `017700000001`, `0`),
  credentials in the URL, `file:` and `gopher:` schemes: all refused.
- Names resolving to private addresses (`localhost`, `localhost.localdomain`, `127.0.0.1.nip.io`):
  refused by `safeLookup`, so the checked address is the one connected to (DNS-rebinding resistant).
- Redirects (including to `169.254.169.254`): reported as data, never followed.
- Gzip bomb (60 MiB of zeros in under 200 KB): stopped at the 50 MiB + 1 output cap.
- Slow and byte-trickling servers: ended at the total wall-clock deadline (idle timeout would not).
- Index with hundreds of children: at most 10 documents; children with an invalid `<loc>` never
  requested. Entry flood: stopped at 50,001. DTD entities: not expanded (`saxes` rejects them).
- No new Puppeteer/CDP session and no Chromium flags: sandbox unaffected.

No `critical` findings. Findings 1 and 2 (`high`) are fixed on a branch awaiting merge; per the
agent's rule they should land before the next feature starts.

## 2026-09-30 — private-network opt-in (follow-up to sitemap-fetch-and-parse, finding 4)

Adds `LHCI_SEO_ALLOW_PRIVATE_NETWORK` to `safe-fetch.js`, at the developer's request: their CI audits
public URLs and also localhost/private staging, where the SSRF policy blocked legitimate fetches.
This is a deliberate, narrow weakening of the SSRF protection, reviewed as such.

- severity: low (residual risk from a new capability, not a defect)
- finding: with the variable set, requests to loopback, RFC 1918 and IPv6 unique-local addresses are
  allowed. Risk: a job that sets it while auditing pages it does not control, from a runner that can
  reach internal services, lets a hostile page (via `og:image`, manifest or `Sitemap:` URLs) make the
  CLI issue GETs to those services. Bounded by design: (1) off by default; (2) set only by the process
  environment, never by page content; (3) read per request, no caching; (4) it unblocks a fixed
  allowlist (`isPermittedPrivateAddress`), so the metadata address, all link-local, `0.0.0.0`, CGNAT,
  multicast and the embedded-IPv4 forms (mapped, NAT64, 6to4) of those stay blocked; (5) only exactly
  `1`/`true` count; (6) every request path (`safeLookup`, and the three literal-IP checks) goes through
  the single `isBlockedAddress` decision, so there is no path that bypasses it.
- status: accepted. README says to set it only on jobs that audit hosts you control. Finding 4 of the
  sitemap review (silent not-applicable with no reason) is resolved by the same change: the artifact
  records `unavailableReason` and the gatherer adds a run warning.

## 2026-09-30 — sitemap-url-status (Phase 4 item 5)

Reviewed as it was built, since it is the first audit that requests the audited site's *pages* from
URLs listed in a sitemap (an attacker-influenced list), not just files discovered through robots.txt.

- severity: none found (no finding to log); recorded for completeness
- checked: (1) **only same-origin URLs are requested**, compared by full origin (scheme, host and port,
  so `www`, another port or `http` vs `https` all count as other-host) against the sitemap that listed
  them, so a sitemap cannot make the CLI request a different host (including internal ones) beyond the
  sitemap's own; (2) every request goes through `safeFetchStatus`: scheme allowlist, private-address
  blocking (with the IPv6 fix and the private-network opt-in rules, no separate path), no redirects
  followed, no body read; (3) bounded: sample size at most 25 (`LHCI_SEO_SITEMAP_SAMPLE_SIZE` is
  clamped, environment only, invalid values fall back to 10), 5 in flight, 5 s hard per-request timeout
  enforced with a race (the fetcher's own timeout is only an idle timeout), one retry for a network
  error only, and a 30 s budget after which the rest are reported as not checked; worst case is about
  30 s plus one in-flight request each; (4) the sample is deterministic, so it cannot be steered
  per run, and it takes at most 25 requests to a host the operator already audits; (5) data exposure:
  the report lists sampled URLs, statuses and error text only, never response bodies or headers other
  than a redirect's `Location`.
- status: n/a

## 2026-09-30 — llms-txt-structure (Phase 4 item 10)

Reviewed as built: a new gatherer with one outbound request.

- severity: none found (no finding to log); recorded for completeness
- checked: (1) the URL is built from the audited page's own origin plus the fixed path `/llms.txt`;
  nothing on the page can change it, and the file's links are never fetched; (2) the request is
  `safeFetchBytes`: scheme allowlist, private-address blocking (including the IPv6 fix and the
  private-network opt-in rules, no separate path), no redirects followed (a redirect is reported with
  its target, not requested), 1 MiB body cap, 5 s total deadline; (3) every outcome is data: a refused,
  slow, oversized or failing fetch cannot throw or hang the run, and adds a run warning; (4) parsing
  is line-by-line with simple anchored patterns (no nested quantifiers, none of the backtracking
  behavior a regular-expression denial of service needs) over at most 1 MiB, and an odd-input test
  confirms it does not throw; (5) data exposure: the report shows line numbers, format problems and
  link counts, never the file's contents beyond short problem descriptions.
- status: n/a

## 2026-10-01 — sitemap-indexability

Reviewed `git diff 58c6a52..593f514` (13 commits: `safeFetchPrefix`, `html-head-signals`, `noindexFor`,
the page sample in `SitemapDocuments`, the refactored `sitemap-url-status`, the new audit). The new
surface is a body read from page-controlled URLs, an HTML parse of attacker-influenced text, and
strings from the audited site flowing into the report. Every attack below was **run against the real
code**, not argued from reading it.

### Finding 5

- severity: medium (found during the build and fixed before merge; recorded because it is the kind of
  thing a review must keep looking for)
- finding: **`parse5` is quadratic in the nesting depth of block elements, and parsing is synchronous.**
  64 KiB of `<div>` took 1.6 s to parse, and the same holds for about a dozen other elements (`ul`,
  `ol`, `dl`, `nav`, `pre`, `menu`, `main`, `center`, ...), so it is not specific to `div`. With 25 sampled
  pages that is about 40 s of blocked event loop that no fetch timeout can interrupt, from a page the
  audited site controls. Same class as the sitemap-XML nesting finding (Finding 2).
- status: resolved in task 2, before merge: the parser is given only the text up to the 2,000th `<`
  (a real page has under a hundred head tags). Re-measured after the fix: the worst of **121 element
  names**, nested to the byte limit, is **83 ms** from the body and **92 ms** from inside the head, so 25
  pages cost about 2 s at the very worst. Nine of the ten timing tests fail without the limit, so they do
  guard it. Other hostile shapes measured at under 50 ms: a 64 KiB attribute value, 30,000 entities,
  NULs and control bytes, unterminated tags, adoption-agency and Noah's-Ark patterns, a gzip bomb fed
  to the parser as text.

### Finding 6 (updates Finding 3)

- severity: low
- finding: the gatherer's worst-case wall time grew. Finding 3 noted roughly 105 s for the
  documents. The page sample adds up to about **30 s**: measured with 25 listed pages that never send
  headers, `collectSitemapDocuments` took **30.1 s** (30 requests, every page retried once, 15 pages
  errored, 10 reported not-checked), because the 30 s budget stops new requests but lets in-flight ones
  finish. Combined worst case is therefore about 135-145 s. Still bounded and reported honestly, still
  no overall deadline.
- status: **resolved 2026-10-01** together with Finding 3. Re-measured with the worst site the gatherer can
  be pointed at (four of five sitemaps hang, and every sampled page hangs): **70.0 s** wall time, down
  from the ~135-145 s estimate (40 s for discovery and the documents plus the page sample's own 30 s;
  10 of 25 pages reported as not checked). The documents budget is also tested with a real hanging
  server: five hanging sitemaps end at the budget instead of 5 x 10 s.

### Checked and found sound

- **Slow-loris response** (a header sent one byte every 100 ms, forever): ended at the total deadline
  (1,501 ms for a 1,500 ms deadline), as a rejection.
- **Unbounded fast body** declared `text/html`: capped at 64 KiB in 79 ms, resolved as truncated, request
  destroyed. A reset after the headers resolves as truncated with the partial body.
- **Mislabelled gzip** (a 50 MiB bomb served as `text/html` with no `Content-Encoding`): the 50 KB on the
  wire was read as bytes and never decompressed (no decompression exists on this path), so nothing can
  expand; it parses to no signals and is marked head-incomplete, so it cannot look like a clean pass. A
  declared `Content-Encoding` other than identity skips the body entirely and still returns the headers.
- **300 aborted requests** (caps, resets, deadline expiries): no uncaught exception, no unhandled
  rejection, and the active-handle count did not grow.
- **Same-origin rule** against 20 tricky URLs: userinfo (`example.com@evil.test`), suffix
  (`example.com.evil.test`), percent-encoded slash, other port, other scheme, `www`, subdomain, the
  metadata address (plain and IPv4-mapped), `localhost`, `file:`, `javascript:`, protocol-relative,
  relative, and a Cyrillic homograph were all **skipped, never requested**. The one that looked odd,
  `https://example.com\@evil.test/x`, is requested but its host is `example.com` in both the URL parser
  and Node's `http.request` (a backslash is a slash for https), so it cannot reach `evil.test`.
- **Nothing the page says is ever fetched**: `sitemap-indexability.js` and `html-head-signals.js` import no
  fetch code, and a canonical's target is only compared and displayed, never requested. A redirect's
  `Location` is recorded (capped at 1,000 characters), never followed.
- **Address policy** is the one shared decision point (`isBlockedAddress`), covered by tests through the
  real default path: loopback refused without the opt-in, metadata, IPv6 literals and `0.0.0.0` refused
  even with it, no hint advertised for the ones it cannot unblock.
- **Data exposure**: the request carries only `Accept` and `Accept-Encoding`: no cookies, no auth.
  Response headers kept are an allowlist of four (`x-robots-tag`, `content-type`, `content-encoding`,
  `location`), capped at 10 values of 1,000 characters; a `Set-Cookie` is never stored (tested).
  Raw HTML is never stored in the artifact (tested by serializing it). Strings from the site reaching the
  report are the listed URL and a resolved canonical URL; Lighthouse's renderer shows them as text.
- **Hidden-signal evasion**: a `noindex` meta hidden in a comment, a script string, `<noscript>` or
  `<template>`, or placed in the body, is correctly not counted; a signal that precedes a 3,000-tag
  flood is kept and the head is marked incomplete.
- **Sandbox**: no new CDP session, no Chromium flag. Unchanged.

### Not verified

- `parse5@7.1.2` was not checked against a vulnerability database from here (no such lookup was
  available). It is a widely used, pure-JavaScript parser already in the dependency tree via `jsdom`.
- The audit cannot see a noindex or canonical injected by client-side JavaScript (stated in its own
  description). That is a coverage limit, not a vulnerability.

No `critical` or `high` findings, and none open: Findings 3 and 6 (`low`) were resolved 2026-10-01 by the time-budget fix, and Finding 5 is resolved.

## 2026-10-01 — transport-security

Reviewed `git diff e8ea6a5..fcf095b` (the three audits `mixed-content`, `hsts-quality`,
`ssl-certificate-expiry`, their pure logic and the input resolver). This feature adds **no outbound
request, no new gatherer, no CDP session and no Chromium flag**: it only reads artifacts Lighthouse
already collected, so SSRF, crawler abuse and sandbox risk do not apply (`safe-fetch.js` is not touched).
The new surface is strings the audited site controls (resource URLs, header values, certificate names)
flowing into the report. Attacks below were **run against the real code**.

### Finding 7

- severity: low
- finding: **Site-controlled strings were echoed into the report without a length bound.** A page can
  make insecure requests with very long URLs (Chrome allows URLs far beyond 200 KB): 60 requests with
  200 KB URLs produced a **10 MB** `mixed-content` result, and a malformed `max-age=<250 KB>` header was
  echoed back in full in the `hsts-quality` table. LHR files are stored by `packages/server` and
  shared, so a hostile page could bloat every stored report. Lighthouse's own `is-on-https` has the same
  property for the URLs it lists; this audit only needs to not add to it.
- status: **resolved 2026-10-01** in the commit "fix(seo-audits): cap site-controlled strings in
  transport-security": URLs are cut to 1,000 characters, header values and certificate
  subject/issuer to 200, with the cut stated ("... (N more characters)"). Re-measured: the same attack
  now yields **60 KB** (was 10 MB) and the HSTS echo **889 bytes** (was 250 KB). Four new tests fail
  without the fix. Row count was already capped at 50 (100,000 distinct insecure requests: 12 KB, 108 ms).

### Checked, no finding

- **Markup and link injection through the certificate**: a certificate whose subject is
  `[CLICK TO RENEW](https://evil.test/phish) `code` <b>bold</b>` was served to a real run. In Lighthouse's
  own HTML report (rendered and read back from the DOM) the text appears escaped, as plain text, in both
  the `warnings` path (expiring) and the `explanation` path (expired): **zero anchors** to the attacker's
  URL, no injected element. The raw text is in the LHR JSON, so a different consumer that renders
  Markdown (this repo's `packages/viewer` was not checked) would show it; the 200-character bound limits
  how much.
- **Parser cost on hostile input**: 250 KB header of quotes, a 250 KB quoted `max-age`, 120,000
  directives, and 100,000 insecure requests all finish in under 250 ms; the regular expressions are
  linear (`^\d+$`, `^"(.*)"$`).
- **Data exposure**: no cookies, auth headers or page content are read. Response headers used: only
  `Strict-Transport-Security`. The certificate fields kept: subject, issuer, validity dates (public by
  nature). No request is made, so nothing is sent.
- **Fail-safe direction**: an unfamiliar resource type is treated as active (fails), not waved through;
  a missing certificate date is not-applicable, never a pass by default.

### Not verified

- `packages/viewer` rendering of the new audits (and of the unescaped certificate text) was not checked.
- Hardening note, not a finding: `RESOLUTIONS[issue.resolutionStatus]` indexes a plain object with a
  Chrome-supplied enum; a page cannot choose that value, so it is not reachable, but a `Map` would remove
  the question.

No `critical` or `high` findings. Finding 7 is `low` and resolved.

## 2026-10-01 — soft-not-found (Phase 5 item 5, lightweight mode)

Reviewed with the security checklist while building (lightweight mode, no formal review stage; every
attack below was **run against the real gatherer and `safeFetchStatus`**). New surface: a gatherer that
makes up to four status-only requests to the audited page's own origin.

- **SSRF**: every URL is built from the page's origin plus a random token, never from anything the page
  says; every request goes through `safeFetchStatus` (scheme allowlist, address policy, no redirect
  followed, 5 s). The one derived URL is a redirect target, and it is requested only when it is on the
  **same origin** (scheme, host and port): a redirect to another host, port, scheme, a scheme-relative
  URL, `169.254.169.254`, `file:` or `javascript:` is classified and never requested. Run with a spy
  server on another port: **zero** requests reached it. A redirect loop to itself costs one extra request.
- **Crawler abuse**: bounded at four requests (two probes in parallel, one hop each), 5 s each, about 10 s
  worst case; a server that never answers was cut at 5 s. The probes appear as 404s in the audited site's
  logs; that is documented in the README and the audit description.
- **Data exposure**: the requests carry no cookies or auth headers; only the status and a `Location` are
  read, and the `Location` is cut to 1,000 characters in the report (a 60 KB `Location` is refused by Node's
  parser and recorded as a failed probe). Error text is cut to 300 characters.
- **Sandbox**: no new CDP session or Chromium flag.
- Finding: none. `low`/`medium`/`high`/`critical`: 0. (One non-security defect was found in QA, an audit id
  that breaks `lhci assert`; see `docs/qa/soft-not-found.md`.)
- Not verified: the Windows/IPv6-only network behaviour of `safeFetchStatus` (unchanged by this feature).

## 2026-10-01 — url-variants (Phase 5 item 4, lightweight mode after a design conversation)

Reviewed with the security checklist while building (no formal review stage; this is the first Phase 5
gatherer that follows redirects, so the attacks below were **run against the real gatherer**, with a spy
server). New surface: up to three redirect-following probes of the audited URL's own host variants.

- **SSRF**: every URL starts from the audited page's own host (`http://host`, and the host with `www`
  toggled) and path; each request goes through `safeFetchStatus` (scheme allowlist, address policy,
  DNS-rebinding-safe lookup, no automatic redirect, 5 s). The one derived URL is a redirect target, and it
  is requested **only if its host is one of the page's own two host variants, on the default port, over
  http or https**. A redirect to another host, a lookalike (`example.com.evil.test`), `169.254.169.254`, a
  CDN, another port, `file:` or `javascript:` is recorded and never requested: a spy server on another
  port received **zero** requests, and the unit tests assert the exact list of requested URLs.
  Note the audited host is `finalDisplayedUrl`, so a page that redirects to a chosen host makes that host
  the base; the address policy (not the variant rule) is what stops that from reaching a private address,
  and it does (the opt-in is the only way past it).
- **Crawler abuse**: bounded at three variants, 5 hops each (6 requests per variant at most), 5 s per
  request and a 20 s budget per variant (the variants run in parallel), so about 20 s worst case and 18
  requests at most. Loops end at the first revisited URL (fragment ignored), a redirect to itself costs one
  extra request, and an endless chain of distinct URLs stops at the hop limit (tested with 20 distinct hops:
  6 requests made).
- **Wildcard-DNS false positives**: not a security issue but an accuracy one, found while designing: probing
  `www.app.example.com` would be answered by a wildcard record and reported as a duplicate. `www` is toggled
  only for an apex or `www.` host; stated in the README.
- **Data exposure**: no cookies or auth headers are sent; only the status and `Location` of each hop are
  stored. URLs and error text in the report are cut (1,000 and 300 characters).
- **Sandbox**: no new CDP session or Chromium flag.
- Finding: none. `critical`/`high`/`medium`/`low`: 0.
- Not verified: behaviour of the hop-following against a server that answers each hop slowly but within
  5 s (the 20 s per-variant budget is unit-tested with a fake clock only).

## 2026-10-01 — indexability (Phase 6, lightweight mode after a design conversation)

Reviewed with the security checklist while building; every attack below was **run against the real gatherer
and a spy server**. New surface: one request, to a URL the audited page chooses (its canonical).

- **SSRF**: the canonical is page-controlled, so it is requested only when it is on the **page's own origin**
  (scheme, host and port): a canonical on another host, a lookalike, another port, another scheme,
  `169.254.169.254`, a scheme-relative `//evil.test`, or a non-http scheme is recorded and never requested; a
  spy server on another port got **zero** requests, and the unit tests assert the exact list of requested URLs
  (none). The request itself goes through `checkUrls` and `safeFetchPrefix` (scheme allowlist, address
  policy, DNS-rebinding-safe lookup, no redirect followed). Several different canonicals are not requested
  at all.
- **Crawler abuse**: at most one request per audited page (plus `checkUrls`' single retry for a network
  error), 5 s, first 64 KiB of HTML; `parse5`'s input is already capped (Finding 5).
- **Data exposure**: no cookies or auth headers are sent; the report holds the canonical URL, the target's
  status, redirect `Location` and robots signals (cut to 1,000 characters), never page content.
- **Sandbox**: no new CDP session or Chromium flag; the in-page read is a single `evaluate` of a fixed
  function (selects `link[rel~=canonical]` in the head and measures `innerText` length), isolated world.
- Finding: none. `critical`/`high`/`medium`/`low`: 0.
- Not verified: a target that answers slowly but inside 5 s many times (one request only, so not applicable).

## 2026-10-01 — site-crawler (Phase 7 item 0, full pipeline)

Reviewed `git diff d53c327..cebec83` (11 commits: the snapshot types, the `htmlparser2` extractor, the `userAgent` option on
`safeFetchPrefix`, the cache, the crawl orchestration, the gatherer, the audit). This is the largest new surface in the fork:
it makes up to about 100 requests per cold crawl to URLs the audited page influences, parses attacker-influenced HTML at 512 KiB,
and keeps a cache on disk. Every attack below was **run against the real code** (hostile servers, real filesystem).

### Finding 8

- severity: low
- finding: **The crawler's robots.txt and sitemap requests do not carry its user-agent.** Page requests send
  `lhci-seo-audits-crawler/1.0` (a new validated option on `safeFetchPrefix`), but `safeFetchBytes`, which fetches robots.txt and the
  sitemap files, has no such option, so those requests identify as nothing at all in the audited site's logs. A politeness and
  attribution gap, not an exposure: the requests are bounded and SSRF-protected like the rest.
- status: **fixed** (2026-10-01). `safeFetchBytes` has the same additive, validated `userAgent` option (printable ASCII, 1-200
  characters, rejected before any lookup or connection; absent, no header, as before), and the crawler passes its user-agent on
  every robots.txt and sitemap request. Verified live: a spy server saw `lhci-seo-audits-crawler/1.0` on `/robots.txt`,
  `/sitemap.xml` and the pages. Phase 4's own standalone sitemap gatherer and `llms-txt` do not set it and are unchanged.

### Checked, no finding

- **Parsing denial of service (the open question of the design, measured).** `parse5` at 512 KiB: **108.8 s** for 200,000 nested
  `<div>` and **113.9 s** for nested lists, for one page. The crawler uses `htmlparser2`, a streaming tokenizer: worst case
  **53 ms** (232 ms under Jest) across 17 hostile shapes, each asserted under 2 s in the tests (nested block elements, misnested
  formatting, tables, 100k links, 170k `<p>`, entity and comment floods, huge attributes, repeated `<body>`/`<head>`, NUL bytes).
  A quadratic loop over the element stack on repeated `<body>` tags was found and fixed while writing it.
- **SSRF**: every request is built from the audited origin; a candidate URL is requested only if it is **on that origin**
  (scheme, host, port); redirects are followed only within the origin, for at most 3 rounds. The spy server on another origin
  received **zero** requests from page links, sitemap URLs and redirects; lookalike hosts, other ports, `169.254.169.254`, credentialed
  URLs, `javascript:`, `mailto:` and `file:` are all rejected (unit tests assert the exact list of requested URLs; a mutation test
  removing the origin check failed 3 tests). All requests go through `safe-fetch.js`, so the address policy and
  `LHCI_SEO_ALLOW_PRIVATE_NETWORK` apply.
- **Header injection through the new `userAgent` option**: CR, LF, NUL, tab, DEL, non-ASCII, empty, over-200 and non-string values
  all reject **before any DNS lookup or connection** (19 tests; disabling the validation fails 15 of them).
- **The cache**: a symlinked cache directory is never written to; a forged snapshot in a directory open to other users is ignored;
  a cache file symlinked to `/etc/passwd` is not followed; a hostile key cannot leave the directory (always a 64-character hex
  name); a corrupt, wrong-version, future-dated or oversized file is ignored; writes are atomic (three parallel crawls, one valid
  file; real concurrent processes in a test). Found and fixed while testing: **Node's recursive `mkdir` hangs forever on an
  uncreatable path** (for example under `/proc`), which would have frozen a Lighthouse run for a bad `LHCI_SEO_CRAWL_CACHE_DIR`;
  the cache now creates one level only.
- **Resource bounds**: a 100,000-link page is an 11 KB snapshot; 200 pages of 400 KB with 200 links each took 2.6 s and made 201
  requests; an endless body, a trickling body and an endless redirect chain ended in 5 s. Peak memory for that 200-page worst case is
  about 370 MB resident, and the live heap afterwards is 13 to 15 MB (measured with a forced GC; not retention).
- **Data exposure**: no cookies or auth headers are sent; the snapshot holds extracted fields only (never raw HTML), a hash of the
  visible text (not reversible to it), URLs and short strings, each capped.
- **Sandbox**: no new CDP session or Chromium flag; the in-page read is one fixed function in an isolated world.

### Not verified

- `htmlparser2@6.1.0` (2021) was not checked against a vulnerability database from here (no lookup was available); the risk is bounded by
  the body cap, the timing tests on hostile input, and its use for extraction only.
- The `lhci` run under a real GitHub Actions job (the cache directory under `os.tmpdir()` on a shared runner).

No `critical`, `high` or `medium` findings. Finding 8 (`low`) is fixed; none open.

## 2026-10-02 — phase-7 cross-page audits (duplicate-titles, duplicate-descriptions, thin-content, canonical-conflicts, duplicate-content; lightweight)

No new request, gatherer, file or dependency: the five audits read the crawl snapshot. The risks left are time and output size
on a hostile crawl, so each builder was run on worst-case snapshots (200 pages, 1,000-character titles and descriptions, URLs of
2,000 characters, 512 KiB bodies, a 200-page canonical chain, a 200-page canonical cycle, 200 pages all identical, slash-only paths).

### Finding 9

- severity: low
- finding: **`duplicate-content` took about 0.87 s on a hostile crawl.** `baseKey` stripped trailing slashes with `/\/+$/`, which is
  quadratic on a path made of many slashes. Bounded by the 2,000-character URL cap and the 200-page cap, so a second at worst, not a hang.
- status: **fixed** (2026-10-02): a linear loop replaces the regex (worst case 6 ms); a test with a 200,000-slash path asserts it stays
  fast (the regex took many seconds there).

### Checked, no finding

- **Time**: the worst case for the other four builders is 86 ms (`canonical-conflicts` on a 200-page chain: each walk is capped at 10 hops).
- **Output size**: at most 25 KiB per audit (rows capped at 50, every cell clipped to 100 to 200 characters), so a hostile site cannot
  inflate the report.
- **Injection into the report**: page-controlled text (titles, descriptions, URLs) is put in table cells only, clipped, never in a
  title, a score or an id.
- **No panics on odd input**: every builder is unit-tested with a missing, disabled and malformed crawl and returns "not applicable".

No `critical`, `high` or `medium` findings; Finding 9 is `low` and fixed; none open.

## 2026-10-05 — link-graph-crawler (Phase 8 item 0, lightweight)

Reviewed with the security checklist while building; every attack below was **run against the real crawler** (a local site, spy servers,
the real fetch path), not only unit-tested. New surface: link-following (more requests to the audited site's own pages), one extra seed (the
homepage, same origin), and more page-controlled strings in the snapshot (anchor text, external link URLs).

- **Other origins are never requested.** A spy server on another port, linked from the homepage as an absolute URL, received **zero**
  requests; external links are stored (capped) and never requested here. Every candidate URL is the output of `normalizeUrl` and a
  same-origin check; `javascript:`, `mailto:` and credentialed URLs are dropped by the extractor.
- **robots.txt**: `/private/` was linked from the homepage and never requested; a homepage that robots.txt disallows is recorded, not requested.
  If robots.txt cannot be read, only the audited page is requested (no link-following).
- **Bounds hold against a hostile site**: a site whose every page links to 250 new pages and 60 external URLs, run at the maximum settings (200 pages,
  depth 5): 200 pages, 201 requests (the cap is 600), 2.2 s, at most 500 distinct external links kept; at the default 50 pages, 1.5 s. A page
  chain that never ends stops at the depth bound (`cutByDepth`).
- **Crawl traps**: a calendar-style query-string trap stops at 5 variants of one path; files (`.png`, `.pdf`, `.js`) are not requested.
- **Crawled once across processes** (a real `lhci collect`, 2 URLs x 2 runs): 41 distinct paths requested, only the two audited URLs more than once
  (Lighthouse's own page loads); one cache file. The cache key now includes the depth and the snapshot version, so an older file is ignored.
- **Parsing**: the new anchor, alt-text, external-link and pagination reads are linear: hostile 512 KiB inputs (an unclosed `<a>` repeated, one enormous
  anchor, an alt-text flood, 15,000 external links, a pagination flood) all extract in under 2 s with bounded output (asserted in tests).

### Finding 10

- severity: low
- finding: **A hostile site can make the snapshot bigger than the cache allows and the crawl heavy on memory.** Links are stored with their URL (up
  to 2,000 characters) and anchor text. A site whose pages each have 200 links, every one a 1,900-character URL, gives a snapshot of **20 MiB at the default
  50 pages (about 360 MB resident, 1.5 s)** and **81 MiB at 200 pages (about 750 MB, 5 s)**. The cache refuses a file over 16 MiB, so each Lighthouse run of
  that collect crawls again (still inside its own bounds). It needs a hostile or very odd site that the developer chose to audit; no exposure beyond cost.
- status: **fixed 2026-10-06**: a per-page budget of 40,000 characters of stored link URLs in `crawl-extract.js`. Earlier note: open, accepted. Recorded in
  `.ai-agents/state/ci-backlog.md` and `docs/open-items.md`.

### Not verified

- A real GitHub Actions run (a shared runner's memory and the cache directory), as for the crawler itself.

No `critical`, `high` or `medium` findings. Finding 10 is `low` and open (accepted).

## 2026-10-05 — link-graph-audits (Phase 8 items 1 and 2, lightweight)

No new request, gatherer, file or dependency: the four audits (`dead-end-pages`, `internal-link-counts`, `orphan-pages`, `crawl-depth`) read the crawl snapshot.
The risks left are time and output size on a hostile snapshot, so each builder was run on worst-case snapshots (200 pages; every page linking to all 199 others, with
1,900-character URLs; a 200-page chain; a star).

- **Time**: first fixed a measured weakness (1.7 s for one builder on the long-URL complete graph, from normalising every link several times); each page's targets
  are now computed once: worst case **0.37 s**, then about 25 ms per builder; a chain or a star under 4 ms. Bounded by the 200-page and 200-links-per-page caps of the crawler.
- **Output size**: at most 15 KiB per audit (rows capped at 50, cells clipped to 200 characters), so a hostile site cannot inflate the report.
- **Injection into the report**: page-controlled URLs are put in table cells only, clipped, never in a title, a score or an id.
- **No panics**: every builder is unit-tested with a missing, disabled, unavailable and malformed crawl and returns "not applicable".

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 (from item 0) remains open and accepted.

## 2026-10-05 — link-check-audits (Phase 8 item 3, lightweight, a new request surface)

New surface: up to 100 status-only requests per Lighthouse run to same-origin URLs that the audited page links to (`checkAuditedLinks`), through the same fetch
(`safe-fetch.js`, the private-address policy, `LHCI_SEO_ALLOW_PRIVATE_NETWORK`). Every attack below was **run against the real crawler** with hostile and spy servers.

- **Other origins**: only same-origin targets are requested (the filter is `sameOrigin` on a normalised URL). Two links that redirect to another origin: the spy server
  received **zero** requests; the redirect is recorded and not followed.
- **robots.txt**: honoured for every target; a disallowed target is recorded, never requested; an unreadable robots.txt means no checks.
- **Bounds**: at most 100 targets, 3 requests each, a 30 s budget, 5 s per request, bodies read to at most 2 KiB. A server with 60 hanging, 60 forever-redirecting and
  60 5-MiB links: the run ended at the budget with 40 requests and 164 targets counted as not checked (not misreported as broken).
- **Cost to the audited site**: up to about 300 requests per Lighthouse run in the worst case, visible in its logs with the crawler user-agent; switchable with
  `LHCI_SEO_CRAWL_MAX_LINK_CHECKS=0`.
- **Outcome integrity** (a correctness bug with a security flavour, fixed): URLs the time budget never let the crawler request were recorded as pages that "did not
  answer"; they could have made an audit assert a false "broken link". They are now skipped entries, and the link checks count unrequested targets as "not checked".

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 (item 0) remains open and accepted.

## 2026-10-05 — anchor-text-audits (Phase 8 item 4, lightweight)

No new request, gatherer, file or dependency: `anchor-text-diversity` and `descriptive-anchor-text` read the crawl snapshot. The extractor now also reads `aria-label` and `title` (clipped to
400 characters before use, 100 stored), which adds no request. Risks left are time and output size on a hostile snapshot: 200 pages x 200 links with 100-character anchors, every page
linking to every other: worst **246 ms**, output at most **6 KiB** (rows capped at 50, cells clipped). Page-controlled anchor text appears in table cells only, clipped, never in a title, score or id.

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 (item 0) remains open and accepted.

## 2026-10-05 — pagination-audits (Phase 8 item 5, lightweight)

No new request pattern: the audited page's `rel=next` / `rel=prev` targets join its own links in the existing status checks (same-origin only, robots.txt honoured, no body read, 100 at most,
30 s budget; see the link-check-audits entry). The three audits read the crawl snapshot. Risks left are time and output size on a hostile snapshot (200 pages, each with 5 `next` and 5
`prev` targets, 1,900-character URLs): `pagination-links` took **3.9 s** (a scan per lookup) and now takes **175 ms** after indexing pages by URL; the other two under 60 ms. Output at most 51 KiB
(rows capped at 100, cells clipped to 200 characters). Page-controlled URLs appear in table cells only, never in a title, score or id.

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 (item 0) remains open and accepted.

## 2026-10-05 — external-link-audit (Phase 8 item 6, lightweight with a careful review)

The first request surface of the fork that goes to **other people's sites**: up to 20 external links of the audited page, chosen by the page, requested on every run. Reviewed with the security checklist while
building; every attack below was **run**: some against the real fetch path, the rest as unit tests that fail if the protection is removed.

- **SSRF, the central risk.** The page chooses the URL, so a link can point at loopback, a private network or the cloud metadata address. The audit needs `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` to audit a site on
  localhost, and that opt-in would have unblocked loopback and private ranges for these links too. A new strict fetch (`safeFetchPublicPrefix`, `publicOnlyLookup`, built from the same lookup factory as the
  existing one, so there is one implementation) refuses every private or reserved address **whatever the environment says**, at the literal-IP check, at DNS resolution (a host name that resolves to loopback is
  refused) and for every redirect hop. Run: with the opt-in on, a page linking to `127.0.0.1`, `localhost`, `[::1]`, `169.254.169.254` and `10.0.0.5` made **zero** requests (a spy server saw none); 14 unit
  tests and an integration test over real local servers cover the address kinds and fail if the opt-in leaks in.
- **Cost to third parties**: at most 20 URLs, 2 per host, one at a time per host, 5 in flight overall, 5 s per request, 3 redirect hops, a 15 s total budget, 1 KiB of body, the crawler user-agent, no cookies,
  credentials or custom headers, no third-party robots.txt (a decision with the developer: a status check of a link the audited site publishes is what a browser prefetch does). It can be switched off
  (`LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS=0`) and is counted in `crawl-coverage`.
- **Amplification and hangs**: hosts are checked in parallel but a host's links one after another; redirects are followed manually for 3 hops and a loop or an endless chain ends with `TOO_MANY_REDIRECTS`
  (tested); a response that never comes ends at the 5 s request timeout; the total budget stops new requests, and unreached links are counted, not guessed.
- **Information leaked to third parties**: only the URL requested and the crawler's user-agent. Nothing from the audited site (cookies, headers, referrer) is sent; the link a page publishes already tells
  that host where it points.
- **Report integrity**: a link refused for pointing at a private address, or blocked (401, 403, 429, 999), or flaky (5xx, timeout) is never reported as broken; only a 404, a 410, a host that does not exist or a refused
  connection fails. Page-controlled text (URLs, anchors) appears in table cells only, clipped to 200 characters, at most 50 rows.

### Not verified

- Behaviour against a wide range of real third-party sites (rate-limiting, tarpits, odd redirects); only `example.com` and made-up hosts were used.
- A real GitHub Actions run (runner egress and DNS).

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 (item 0) remains open and accepted.

## 2026-10-05 — url-quality-audits (Phase 9, lightweight)

Pure string checks on URLs; **no new request surface, no new gatherer, no new environment variable**. Reviewed with the security checklist.

- **Page-controlled input**: URLs come from links and sitemap entries a hostile site chooses. Every pattern was read for backtracking: `/\/{2,}/`, `/%(?![0-9a-f]{2})/`, `/%25[0-9a-f]{2}/` and the anchored identifier test are linear. One was not: trailing-slash stripping with `/\/+$/` is quadratic on a long run of slashes (the Finding 9 shape); it was caught while writing and is a loop, with a 200,000-slash timing test (2 ms).
- **Output**: URLs appear in table cells only, clipped to 200 characters, at most 50 rows and 15 groups; parameter names are clipped to 40 characters.
- **Credentials**: a URL carrying credentials never reaches these audits as a crawled page (the crawler's normaliser rejects it).
- **Related fix found by the live run (correctness, not a security risk)**: a cached crawl reused by another URL of the same collect kept the first URL's `audited` label, so cross-page audits judged the wrong page. Fixed with tests.

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 remains open and accepted.

## 2026-10-05 — image-audits (Phase 10, lightweight)

One new gatherer (`ImageAltText`) and seven audits; **no new request surface and no new environment variable** (the audits read the page's own network log and DOM data).

- **Page-controlled input**: alt text, image URLs and file names come from the audited page. The gatherer runs in the isolated world, reads attributes only, caps the list at 500 images and the strings at 300 (alt) and 1,000 (URL) characters. Every regular expression is anchored or linear on those bounded strings; the file-name rules run on a decoded name (a malformed escape is kept raw, tested).
- **No fetching**: image bytes are never requested by the audits; sizes and statuses come from the load Lighthouse already recorded. `data:` URLs are skipped.
- **Output**: URLs and alt text appear in table cells only, clipped to 200 characters, at most 50 rows.

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 remains open and accepted.

## 2026-10-05 — js-rendering-audits (Phase 12, lightweight)

Two new gatherers and seven audits. One new request surface: **`device-content-parity` requests the audited page twice** (a mobile and a desktop user-agent).

- **Requests**: only the audited URL, the one Lighthouse already loaded; no URL taken from the page is ever requested. Through the SSRF-protected `safeFetchPrefix` (private addresses refused unless `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1`), first 512 KiB, 10 s each, no redirect followed (a redirect makes the page "not comparable"), a non-http URL is refused before any request. Switch-off: `LHCI_SEO_DEVICE_PARITY=0` (tested: no request made).
- **User-agent**: two constants in the source, not page-controlled, printable ASCII under 200 characters (the safe fetch re-validates), each ending in `lhci-seo-audits/1.0` so the site can see who asked; no impersonation of Googlebot.
- **Page-controlled input and parsing**: the raw and rendered HTML go through the existing linear extractor (`crawl-extract.js`, the streaming tokenizer); the rendered DOM is capped at 2 MiB of characters in the gatherer. Framework-hint patterns run on the first 512 KiB and are linear.
- **A quadratic pattern found by running it**: the hydration-error pattern (`hydrat\w*\s+...`) is **not linear** on a long run of repeated "hydrat" (a 3 MB console message hung the process while I measured the uncapped pattern). Console text is chosen by the page, so each message is now capped at 2,000 characters before the pattern runs, with a 500,000-repetition test (3 ms). Low severity: the console message list is bounded by Lighthouse, and the effect would have been a hung audit, not data exposure; fixed before merge.
- **Output**: titles, descriptions, URLs and console text appear in table cells only, clipped (120 to 300 characters), at most 50 rows.
- **Cost to the audited site**: two more requests per run to the audited URL (and the existing crawl is unchanged).

No `critical`, `high` or `medium` findings, and no new `low` finding left open; Finding 10 remains open and accepted.

## 2026-10-05 — performance-audits (Phase 13, lightweight with a careful review)

The first audit that sends a **secret** and the audited page's address to a **third party** (Google's CrUX API). Off unless `LHCI_SEO_CRUX_API_KEY` is set.

- **The key**: read only from the environment (never a config file); sent in the `X-Goog-Api-Key` header, never in the URL or body; never placed in the artifact, the report or an error message (tested: a thrown error, bad JSON, and an error body that echoes the key all come back scrubbed). Run: with a fake key the real API answered 400 and the key was absent from the result.
- **What is sent**: the origin and path of the audited page and the form factor. The **query string and fragment are dropped** (they may carry tokens). **An address that is not a public host name is never sent**: localhost, any IP literal, a name without a dot, `.local`/`.internal`/`.lan`/`.test` and similar (tested; run: a localhost page with a key set made no request). The audited URL is chosen by the user, so this is a disclosure to Google of a site the user audits, stated in the README and in the audit description.
- **SSRF**: not applicable: the request goes to one fixed host (`chromeuxreport.googleapis.com`, constant in the source); no URL taken from the page or the response is ever requested. No redirect is followed.
- **Bounds**: 8 s timeout, a 256 KiB response cap (the request is destroyed when exceeded), at most two requests per run (URL, then origin). Output is parsed defensively (a missing or malformed record is "no data").
- **Report integrity**: missing key, no data, an API error and a non-public address are "not applicable" with a reason, never a failure; a metric must be "poor" at the 75th percentile by Google's published thresholds to fail.
- **The two reports** read the HTML and the network log already collected (no request). The HTML is parsed with the linear streaming tokenizer, only the part before `<body>`, capped at 2 MiB, at most 100 resources.

### Not verified

- The success path with a real key and real CrUX data.
- Behaviour at the API quota (a 429 is reported as "quota exceeded", unit-tested only).

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 remains open and accepted.

## 2026-10-05 — hreflang-audits (Phase 11, lightweight with a careful review)

A new request surface: up to 10 **alternate versions named by the audited page** are requested on every run. The page chooses these URLs, so the SSRF controls are the central point.

- **SSRF.** An alternate on the page's own origin uses the normal safe fetch (address policy, honours `LHCI_SEO_ALLOW_PRIVATE_NETWORK`). An alternate on **any other origin** uses the strict public-only fetch (`safeFetchPublicPrefix`), which refuses private and reserved addresses **whatever the environment says**, at the literal-IP check, at DNS resolution and for every hop. Run: with the opt-in on, a page naming `localhost:9523` as an alternate caused **zero** requests (a spy server's log stayed empty); the audit reported a note ("a private address, not requested"). No redirect is followed, so a redirect cannot aim a request elsewhere.
- **Cost to third parties and the site.** At most 10 distinct alternates (default; `LHCI_SEO_HREFLANG_MAX_CHECKS`, hard cap 25, `0` off), never the page itself, one request at a time per host and at most 5 hosts in parallel, the first 128 KiB, about 5 s each and 20 s in all, the crawler's user-agent, no cookies. Unreached alternates are counted, not guessed.
- **Page-controlled parsing.** The alternates' HTML is read with the linear streaming tokenizer over the part before `<body>`, at most 100 alternates and 5 canonicals per page; a half-written last tag of a truncated body is dropped; a 40,000-meta head and a 100,000-nested-div head parse in well under a second (tested). URL comparison uses `looseKey`, which strips trailing slashes with a loop (a `/\/+$/` pattern would be quadratic; tested at 200,000 slashes). Table cells show clipped values only, at most 50 rows.
- **Sitemap capture.** `<xhtml:link>` entries are recorded only for the audited URL's own `<url>` (at most 100), so a huge sitemap never grows the artifact; the existing XML limits (depth, size, entry count) are unchanged.
- **Report integrity.** Bot protection (401/403/429), server errors, timeouts and TLS errors on an alternate are notes, never failures; a return link is judged only when the alternate has hreflang tags in its HTML.
- **A model-output lesson, not a code risk:** the first two attempts to write the library were rejected by the API's content filter while emitting long literal ISO code lists; the lists are now not typed at all (the locale data of the runtime answers).

### Not verified

- Behaviour against many real multi-domain sites and CDNs that treat bots differently.

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 remains open and accepted.

## 2026-10-05 — content-audits (Phase 14, lightweight)

One new gatherer (`PageContent`, in the page's isolated context) and five audits. **No request and no new environment variable.**

- **Page-controlled text.** The page's visible text, title and dates are chosen by the page. The gatherer caps the text at 200,000 characters and reads at most 4,000 elements, 5 hidden-text samples, 20 `<time>` elements and 5 headings. Every regular expression that runs on the text is bounded or linear: the template-tag patterns use bounded negated classes (`\{\{[^{}\n]{1,80}\}\}`) rather than `\s*[...]\s*` (which has overlapping alternatives), and the text scanned is capped. Tests run hostile inputs (190,000 spaces after `{{`, 190,000 `=` after `<%`, 30,000 `{{ x `, one 190,000-letter word) in well under a second.
- **Cost in the browser.** The hidden-text scan calls `getComputedStyle` on at most 4,000 elements and walks ancestor backgrounds; it is bounded and ran in the live collect without a measurable delay.
- **Output.** Page text appears in table cells only, clipped (80 to 200 characters), at most 50 rows; hidden-text samples are at most 80 characters.
- **No information leaves the machine**: nothing is fetched or sent; JSON-LD is parsed with `JSON.parse` and the existing typed-entity helper (no code evaluation).
- **False-positive note, not a risk:** a page about lorem ipsum or a template tool is reported by `placeholder-content`; stated in the audit description.

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 remains open and accepted.

## 2026-10-05 — ai-search-audits (Phase 15, lightweight)

Two new gatherers and four informational audits. One new request: **`amp-check` requests the AMP version a page links to, once**, with the same policy as the hreflang requests.

- **SSRF.** The AMP URL is chosen by the page. It is requested through `checkAlternates` (Phase 11): on the page's own origin through the normal safe fetch, on any other host through the strict public-only fetch, which refuses private and reserved addresses whatever `LHCI_SEO_ALLOW_PRIVATE_NETWORK` says. No redirect is followed. At most one request, the first 128 KiB, about 5 s, the crawler's user-agent, no cookies. `LHCI_SEO_AMP_CHECK=0` switches it off (tested: no request made).
- **Everything else reads data already collected**: robots.txt (the existing artifact, parsed with the existing parsers), the page's structure (counts and short strings from the live DOM: at most 80 headings, 30 question headings, texts clipped to 120 to 160 characters), JSON-LD (parsed with `JSON.parse` and the typed-entity helper, at most 20 blocks), the head's meta and link elements.
- **Page-controlled output.** Names, headings and URLs appear in table cells only, clipped (30 to 100 characters), at most 40 to 50 rows. `sameAs` values are tested with a bounded pattern (`^https?://[^\s/]+`, anchored, no nested quantifiers).
- **Report integrity.** Nothing fails or scores; "blocked" in the crawler summary is a statement about robots.txt only and carries a note that blocking is legitimate.

### Not verified

- The cross-origin private-address refusal for an AMP link specifically (the shared fetch policy was proven in Phase 11).

No `critical`, `high` or `medium` findings, and no new `low` finding; Finding 10 remains open and accepted.

